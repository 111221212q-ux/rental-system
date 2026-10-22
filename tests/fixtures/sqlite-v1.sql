
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin','superadmin')),
 active INTEGER NOT NULL DEFAULT 1, firstRental INTEGER NOT NULL DEFAULT 1,
 emailVerified INTEGER NOT NULL DEFAULT 0, passwordVersion INTEGER NOT NULL DEFAULT 0,
 nickname TEXT NOT NULL DEFAULT '', wechat TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 department TEXT NOT NULL DEFAULT '', isTest INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL COLLATE NOCASE UNIQUE,
 category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 totalStock INTEGER NOT NULL CHECK(totalStock >= 0),
 availableStock INTEGER NOT NULL CHECK(availableStock >= 0 AND availableStock <= totalStock),
 maxRentalDays INTEGER NOT NULL CHECK(maxRentalDays > 0), maxRentalQty INTEGER NOT NULL CHECK(maxRentalQty > 0),
 requireApproval INTEGER NOT NULL DEFAULT 1, value REAL NOT NULL DEFAULT 0 CHECK(value >= 0),
 image TEXT NOT NULL DEFAULT '', datasheetUrl TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('available','low_stock','unavailable')),
 isTest INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rentals (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 itemId TEXT REFERENCES items(id) ON DELETE SET NULL, itemCode TEXT NOT NULL, itemName TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), startDate TEXT NOT NULL, endDate TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','active','returned','cancelled')),
 reason TEXT NOT NULL DEFAULT '', adminNotes TEXT NOT NULL DEFAULT '',
 approvedBy TEXT REFERENCES users(id) ON DELETE SET NULL, approvedAt TEXT, pickedAt TEXT, actualReturnDate TEXT,
 isTest INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rentals_user_status ON rentals(userId,status);
CREATE INDEX IF NOT EXISTS rentals_item_status ON rentals(itemId,status);
CREATE INDEX IF NOT EXISTS rentals_end_status ON rentals(endDate,status);
CREATE TABLE IF NOT EXISTS comments (
 id TEXT PRIMARY KEY, itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 500), isPinned INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_item_order ON comments(itemId,isPinned,createdAt);
CREATE TABLE IF NOT EXISTS verification_codes (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
 userId TEXT REFERENCES users(id) ON DELETE CASCADE, codeHash TEXT NOT NULL,
 expiresAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
PRAGMA user_version = 1;
