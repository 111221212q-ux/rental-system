// One-time script: replace old admin/superadmin with new secure superadmin
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const uri = 'mongodb+srv://111221212q_db_user:njh.6f%40PNSL%21gYx@cluster0.jqph8ma.mongodb.net/rental-system?appName=Cluster0';

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const users = db.collection('users');

  // Delete old admin accounts
  const delResult = await users.deleteMany({
    username: { $in: ['admin', 'superadmin'] }
  });
  console.log(`Deleted ${delResult.deletedCount} old admin accounts`);

  // Check if new superadmin already exists
  const existing = await users.findOne({ username: 'sa_882f4ca6' });
  if (existing) {
    console.log('New superadmin already exists, updating password...');
    const hsuper = await bcrypt.hash('02ap2vm!Aa1', 10);
    await users.updateOne(
      { username: 'sa_882f4ca6' },
      { $set: { password: hsuper, active: true } }
    );
    console.log('Password updated');
  } else {
    // Create new superadmin
    const hsuper = await bcrypt.hash('02ap2vm!Aa1', 10);
    await users.insertOne({
      username: 'sa_882f4ca6',
      email: 'admin@rental.local',
      password: hsuper,
      role: 'superadmin',
      active: true,
      phone: '',
      department: '',
      firstRental: false,
      nickname: 'Admin',
      wechat: '',
      createdAt: new Date(),
    });
    console.log('New superadmin created');
  }

  // List remaining admin users
  const admins = await users.find({ role: { $in: ['admin', 'superadmin'] } }).toArray();
  console.log('Remaining admin accounts:');
  admins.forEach(a => console.log(`  ${a.username} (${a.role})`));

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
