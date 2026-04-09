// ── GTV Rental Website — Data Layer ──────────────────────────────────────────
// All data is stored in localStorage so the site works without a server.

const DB = {
  // ── helpers ──────────────────────────────────────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  },
  _set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

  // ── seed default admin if first run ──────────────────────────────────────
  init() {
    if (!localStorage.getItem('gtv_initialized')) {
      this._set('users', [
        { id: 1, username: 'admin', password: 'admin123', isAdmin: true, status: 'active', email: null }
      ]);
      this._set('items', []);
      this._set('rentals', []);
      this._set('announcements', []);
      localStorage.setItem('gtv_initialized', '1');
    }
  },

  // ── session ───────────────────────────────────────────────────────────────
  login(username, password) {
    const users = this._get('users');
    const user = users.find(u => u.username === username && u.password === password && (u.status === 'active' || !u.status));
    if (!user) return null;
    sessionStorage.setItem('gtv_session', JSON.stringify({ id: user.id, username: user.username, isAdmin: user.isAdmin }));
    return user;
  },
  logout() { sessionStorage.removeItem('gtv_session'); window.location.href = 'index.html'; },
  currentUser() {
    try { return JSON.parse(sessionStorage.getItem('gtv_session')); }
    catch { return null; }
  },
  requireLogin() {
    const u = this.currentUser();
    if (!u) window.location.href = 'index.html';
    return u;
  },
  requireAdmin() {
    const u = this.requireLogin();
    if (!u.isAdmin) window.location.href = 'user.html';
    return u;
  },

  // ── users ─────────────────────────────────────────────────────────────────
  getUsers() { return this._get('users'); },

  // Teacher invites a student by email — account is pending until they set up a password
  inviteUser(email, isAdmin = false) {
    const users = this.getUsers();
    if (users.find(u => u.email === email)) return { error: 'An account with that email already exists.' };
    const id    = Date.now();
    const token = crypto.randomUUID();
    users.push({ id, email, username: null, password: null, isAdmin, status: 'pending', token });
    this._set('users', users);
    return { id, token };
  },

  // Student completes setup — sets their own username + password via the emailed link
  completeSetup(token, username, password) {
    const users = this.getUsers();
    const user  = users.find(u => u.token === token && u.status === 'pending');
    if (!user) return { error: 'Invalid or expired setup link.' };
    if (users.find(u => u.username === username && u.id !== user.id)) return { error: 'That username is already taken.' };
    user.username = username;
    user.password = password;
    user.status   = 'active';
    user.token    = null;
    this._set('users', users.map(u => u.id === user.id ? user : u));
    return { id: user.id };
  },

  removeUser(id) {
    this._set('users', this.getUsers().filter(u => u.id !== id));
  },
  updateUser(id, fields) {
    const users = this.getUsers().map(u => u.id === id ? { ...u, ...fields } : u);
    this._set('users', users);
  },

  // ── items ─────────────────────────────────────────────────────────────────
  // requiresApproval: true = teacher must approve before rental is active
  getItems() { return this._get('items'); },
  addItem(name, quantity, requiresApproval = false) {
    const items = this.getItems();
    const id = Date.now();
    items.push({ id, name, quantity: parseInt(quantity), available: parseInt(quantity), requiresApproval });
    this._set('items', items);
    return id;
  },
  removeItem(id) { this._set('items', this.getItems().filter(i => i.id !== id)); },
  updateItem(id, fields) {
    // if changing quantity, keep available in sync
    const items = this.getItems().map(i => {
      if (i.id !== id) return i;
      const updated = { ...i, ...fields };
      if (fields.quantity !== undefined) {
        const rented = i.quantity - i.available;
        const newQty = Math.max(parseInt(fields.quantity), rented);
        updated.quantity  = newQty;
        updated.available = newQty - rented;
      }
      return updated;
    });
    this._set('items', items);
  },

  // ── rentals ───────────────────────────────────────────────────────────────
  // status: 'active' | 'pending' | 'denied'
  getRentals() { return this._get('rentals'); },

  // Student requests a rental. If item requiresApproval → status='pending' (available NOT reduced yet)
  // Otherwise → status='active' (available reduced immediately)
  requestRental(userId, username, itemId) {
    const items = this.getItems();
    const item  = items.find(i => i.id === itemId);
    if (!item || item.available < 1) return { error: 'Item not available.' };

    const status = item.requiresApproval ? 'pending' : 'active';

    if (status === 'active') {
      // reduce available right away
      this._set('items', items.map(i => i.id === itemId ? { ...i, available: i.available - 1 } : i));
    }

    const rentals = this.getRentals();
    const id = Date.now();
    rentals.push({
      id, userId, username, itemId,
      itemName: item.name,
      requiresApproval: item.requiresApproval,
      status,
      requestedAt: new Date().toISOString(),
      rentedAt: status === 'active' ? new Date().toISOString() : null,
      returnedAt: null,
    });
    this._set('rentals', rentals);
    return { id, status };
  },

  // Admin approves a pending request
  approveRental(rentalId) {
    const rentals = this.getRentals();
    const rental  = rentals.find(r => r.id === rentalId);
    if (!rental || rental.status !== 'pending') return;
    rental.status   = 'active';
    rental.rentedAt = new Date().toISOString();
    this._set('rentals', rentals.map(r => r.id === rentalId ? rental : r));
    // reduce available now
    const items = this.getItems().map(i => i.id === rental.itemId ? { ...i, available: i.available - 1 } : i);
    this._set('items', items);
  },

  // Admin denies a pending request
  denyRental(rentalId) {
    const rentals = this.getRentals();
    const rental  = rentals.find(r => r.id === rentalId);
    if (!rental || rental.status !== 'pending') return;
    rental.status = 'denied';
    this._set('rentals', rentals.map(r => r.id === rentalId ? rental : r));
  },

  returnItem(rentalId) {
    const rentals = this.getRentals();
    const rental  = rentals.find(r => r.id === rentalId);
    if (!rental || rental.returnedAt || rental.status !== 'active') return;
    rental.returnedAt = new Date().toISOString();
    this._set('rentals', rentals.map(r => r.id === rentalId ? rental : r));
    const items = this.getItems().map(i => i.id === rental.itemId ? { ...i, available: i.available + 1 } : i);
    this._set('items', items);
  },

  getPendingRentals()          { return this.getRentals().filter(r => r.status === 'pending'); },
  getUserRentals(userId)       { return this.getRentals().filter(r => r.userId === userId); },
  getActiveRentals(userId)     { return this.getUserRentals(userId).filter(r => r.status === 'active' && !r.returnedAt); },

  // ── announcements ─────────────────────────────────────────────────────────
  getAnnouncements() { return this._get('announcements'); },
  addAnnouncement(text) {
    const list = this.getAnnouncements();
    list.unshift({ id: Date.now(), text, createdAt: new Date().toISOString() });
    this._set('announcements', list);
  },
  removeAnnouncement(id) {
    this._set('announcements', this.getAnnouncements().filter(a => a.id !== id));
  },
};

// ── shared util ───────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

DB.init();
