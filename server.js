import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;
const JWT_SECRET = process.env.JWT_SECRET || 'orbit-development-secret';

app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  plan: { type: String, enum: ['free', 'pro', 'campus'], default: 'free' },
  settings: { timezone: { type: String, default: 'America/Los_Angeles' }, weeklyCapacityMinutes: { type: Number, default: 1200 } }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

const membershipSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' }
}, { timestamps: true });
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

const courseSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true }, code: { type: String, required: true }, teacher: String,
  color: { type: String, default: '#79a9ff' }
}, { timestamps: true });

const assignmentSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true }, type: { type: String, default: 'Assignment' },
  dueAt: { type: Date, required: true, index: true }, estimatedMinutes: { type: Number, default: 60 },
  difficulty: { type: Number, min: 1, max: 5, default: 3 }, priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' }, progress: { type: Number, min: 0, max: 100, default: 0 },
  notes: String, subtasks: [{ title: String, description: String, estimatedMinutes: Number, dueAt: Date, completed: { type: Boolean, default: false } }]
}, { timestamps: true });

const focusSessionSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
  durationMinutes: { type: Number, required: true }, notes: String, startedAt: { type: Date, default: Date.now }, completedAt: Date
}, { timestamps: true });

const Organization = mongoose.model('Organization', organizationSchema);
const User = mongoose.model('User', userSchema);
const Membership = mongoose.model('Membership', membershipSchema);
const Course = mongoose.model('Course', courseSchema);
const Assignment = mongoose.model('Assignment', assignmentSchema);
const FocusSession = mongoose.model('FocusSession', focusSessionSchema);

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const slugify = value => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sign = payload => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, JWT_SECRET);
    const membership = await Membership.findOne({ userId: payload.userId, organizationId: payload.organizationId });
    if (!membership) return res.status(403).json({ error: 'You do not belong to this workspace' });
    req.auth = { ...payload, role: membership.role };
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

const tenant = (req, model) => model.find({ organizationId: req.auth.organizationId });
const canManage = role => role === 'owner' || role === 'admin';

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'orbit-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password, organizationName } = req.body;
  if (!name || !email || !password || !organizationName) return res.status(400).json({ error: 'name, email, password, and organizationName are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ error: 'An account with that email already exists' });
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12) });
  const organization = await Organization.create({ name: organizationName, slug: `${slugify(organizationName)}-${Date.now().toString(36)}` });
  await Membership.create({ organizationId: organization._id, userId: user._id, role: 'owner' });
  res.status(201).json({ token: sign({ userId: user._id, organizationId: organization._id }), user: { id: user._id, name: user.name, email: user.email }, organization });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
  const membership = await Membership.findOne({ userId: user._id }).sort({ createdAt: 1 }).populate('organizationId');
  if (!membership) return res.status(403).json({ error: 'No workspace is associated with this account' });
  res.json({ token: sign({ userId: user._id, organizationId: membership.organizationId._id }), user: { id: user._id, name: user.name, email: user.email, role: membership.role }, organization: membership.organizationId });
}));

app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  const [user, organization, membership] = await Promise.all([User.findById(req.auth.userId).select('-passwordHash'), Organization.findById(req.auth.organizationId), Membership.findOne({ userId: req.auth.userId, organizationId: req.auth.organizationId })]);
  res.json({ user, organization, role: membership.role });
}));

app.get('/api/courses', requireAuth, asyncRoute(async (req, res) => res.json((await tenant(req, Course)).sort({ name: 1 }))));
app.post('/api/courses', requireAuth, asyncRoute(async (req, res) => {
  const { name, code, teacher, color } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });
  res.status(201).json(await Course.create({ organizationId: req.auth.organizationId, name, code, teacher, color }));
}));

app.get('/api/assignments', requireAuth, asyncRoute(async (req, res) => {
  const filter = { organizationId: req.auth.organizationId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.courseId) filter.courseId = req.query.courseId;
  if (req.query.priority) filter.priority = req.query.priority;
  const assignments = await Assignment.find(filter).populate('courseId', 'name code color').sort({ dueAt: 1 });
  res.json(assignments);
}));

app.post('/api/assignments', requireAuth, asyncRoute(async (req, res) => {
  const { title, courseId, dueAt, estimatedMinutes, difficulty, priority, type, notes, subtasks } = req.body;
  if (!title || !courseId || !dueAt) return res.status(400).json({ error: 'title, courseId, and dueAt are required' });
  const course = await Course.findOne({ _id: courseId, organizationId: req.auth.organizationId });
  if (!course) return res.status(400).json({ error: 'Course does not belong to this workspace' });
  res.status(201).json(await Assignment.create({ organizationId: req.auth.organizationId, createdBy: req.auth.userId, title, courseId, dueAt, estimatedMinutes, difficulty, priority, type, notes, subtasks }));
}));

app.patch('/api/assignments/:id', requireAuth, asyncRoute(async (req, res) => {
  const allowed = ['title', 'dueAt', 'estimatedMinutes', 'difficulty', 'priority', 'status', 'progress', 'notes', 'subtasks'];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const assignment = await Assignment.findOneAndUpdate({ _id: req.params.id, organizationId: req.auth.organizationId }, update, { new: true, runValidators: true }).populate('courseId', 'name code color');
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  res.json(assignment);
}));

app.delete('/api/assignments/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!canManage(req.auth.role)) return res.status(403).json({ error: 'Only workspace admins can delete assignments' });
  const deleted = await Assignment.findOneAndDelete({ _id: req.params.id, organizationId: req.auth.organizationId });
  if (!deleted) return res.status(404).json({ error: 'Assignment not found' });
  res.status(204).end();
}));

function recommendationScore(assignment) {
  const days = (new Date(assignment.dueAt) - Date.now()) / 86400000;
  const urgency = days < 0 ? 40 : Math.max(0, 20 - days * 3);
  const importance = { High: 18, Medium: 9, Low: 3 }[assignment.priority] || 3;
  return urgency + importance + assignment.difficulty * 4 + assignment.estimatedMinutes / 30 + (100 - assignment.progress) / 20;
}
app.get('/api/recommendations/next', requireAuth, asyncRoute(async (req, res) => {
  const assignments = await Assignment.find({ organizationId: req.auth.organizationId, status: { $ne: 'done' } }).populate('courseId', 'name code color');
  const next = assignments.sort((a, b) => recommendationScore(b) - recommendationScore(a))[0];
  if (!next) return res.json({ assignment: null, explanation: 'You are all caught up.' });
  const days = Math.ceil((new Date(next.dueAt) - Date.now()) / 86400000);
  res.json({ assignment: next, score: Math.round(recommendationScore(next) * 10) / 10, explanation: `Recommended because it is due in ${Math.max(0, days)} day${days === 1 ? '' : 's'}, takes about ${Math.round(next.estimatedMinutes / 60 * 10) / 10} hours, and is ${next.progress}% complete.` });
}));

app.get('/api/analytics', requireAuth, asyncRoute(async (req, res) => {
  const [assignments, focusMinutes] = await Promise.all([Assignment.find({ organizationId: req.auth.organizationId }), FocusSession.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(req.auth.organizationId) } }, { $group: { _id: null, minutes: { $sum: '$durationMinutes' } } }])]);
  const completed = assignments.filter(a => a.status === 'done');
  res.json({ assignmentsTotal: assignments.length, assignmentsCompleted: completed.length, completionRate: assignments.length ? Math.round(completed.length / assignments.length * 100) : 0, focusMinutes: focusMinutes[0]?.minutes || 0 });
}));

app.post('/api/focus-sessions', requireAuth, asyncRoute(async (req, res) => {
  const { assignmentId, durationMinutes, notes, startedAt, completedAt } = req.body;
  if (!durationMinutes || durationMinutes < 1) return res.status(400).json({ error: 'durationMinutes must be at least 1' });
  if (assignmentId && !(await Assignment.exists({ _id: assignmentId, organizationId: req.auth.organizationId }))) return res.status(400).json({ error: 'Assignment does not belong to this workspace' });
  res.status(201).json(await FocusSession.create({ organizationId: req.auth.organizationId, userId: req.auth.userId, assignmentId, durationMinutes, notes, startedAt, completedAt }));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use((error, req, res, next) => { console.error(error); res.status(error.name === 'ValidationError' ? 400 : 500).json({ error: error.name === 'ValidationError' ? error.message : 'Unexpected server error' }); });

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/orbit')
  .then(() => app.listen(PORT, () => console.log(`Orbit running at http://localhost:${PORT}`)))
  .catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
