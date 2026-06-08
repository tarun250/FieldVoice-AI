const db = require('../config/db');

async function initDb() {
  console.log('Initializing database tables...');
  try {
    // 1. Enable uuid-ossp extension
    try {
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      console.log('Extension "uuid-ossp" verified.');
    } catch (e) {
      console.warn('Warning: Could not enable uuid-ossp extension.', e.message);
    }

    // 2. Create workers table
    await db.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('technician', 'supervisor', 'admin')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Workers table verified.');

    // 3. Create equipment table
    await db.query(`
      CREATE TABLE IF NOT EXISTS equipment (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tag VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(100) NOT NULL,
        specifications JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Equipment table verified.');

    // 4. Create work_orders table
    await db.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_id UUID REFERENCES equipment(id) ON DELETE RESTRICT,
        fault_code VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
        actions_taken TEXT,
        parts_required VARCHAR(100)[] NOT NULL DEFAULT '{}',
        logged_by UUID REFERENCES workers(id) ON DELETE RESTRICT,
        offline_created_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Work orders table verified.');

    // 5. Seed default worker
    const workerRes = await db.query(`
      INSERT INTO workers (id, username, full_name, role)
      VALUES ('e3b0c442-98fc-1111-b303-0242ac120002', 'jdoe', 'John Doe', 'technician')
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `);
    if (workerRes.rows.length > 0) {
      console.log('Seeded default technician: John Doe');
    }

    // 6. Seed default equipment
    const equipments = [
      { id: '11111111-1111-1111-1111-111111111111', tag: 'T-402', name: 'Turbine Generator T-402', location: 'Section A' },
      { id: '22222222-2222-2222-2222-222222222222', tag: 'P-101', name: 'Water Pump P-101', location: 'Section B' },
      { id: '33333333-3333-3333-3333-333333333333', tag: 'V-99', name: 'Main Isolation Valve V-99', location: 'Section C' },
      { id: '44444444-4444-4444-4444-444444444444', tag: 'GEN-501', name: 'Emergency Generator GEN-501', location: 'Section D' },
      { id: '55555555-5555-5555-5555-555555555555', tag: 'BOILER-3', name: 'Steam Boiler BOILER-3', location: 'Section E' }
    ];

    for (const eq of equipments) {
      const eqRes = await db.query(`
        INSERT INTO equipment (id, tag, name, location)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tag) DO NOTHING
        RETURNING id
      `, [eq.id, eq.tag, eq.name, eq.location]);
      if (eqRes.rows.length > 0) {
        console.log(`Seeded equipment: ${eq.tag}`);
      }
    }

    // 7. Create voice_transcripts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS voice_transcripts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
        raw_transcript TEXT NOT NULL,
        confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score >= 0.000 AND confidence_score <= 1.000),
        exception_flag BOOLEAN NOT NULL DEFAULT false,
        audio_storage_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Voice transcripts table verified.');

    // Create performance indexes to optimize LEFT JOIN queries
    await db.query('CREATE INDEX IF NOT EXISTS idx_work_orders_eq_id ON work_orders(equipment_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_work_orders_logged_by ON work_orders(logged_by)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_transcripts_wo_id ON voice_transcripts(work_order_id)');
    console.log('Database performance indexes verified.');

    // 8. Seed sample work orders
    const sampleWorkOrders = [
      {
        id: '99999999-9999-9999-9999-999999999999',
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK-OIL',
        severity: 'CRITICAL',
        status: 'OPEN',
        parts_required: ['Gasket', 'Sealant'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '88888888-8888-8888-8888-888888888888',
        equipment_id: '22222222-2222-2222-2222-222222222222',
        fault_code: 'F-MECH-VIB',
        severity: 'MEDIUM',
        status: 'IN_PROGRESS',
        parts_required: ['Ball Bearing'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: 'Greased outer casing joints'
      }
    ];

    for (const wo of sampleWorkOrders) {
      await db.query(`
        INSERT INTO work_orders (id, equipment_id, fault_code, severity, status, parts_required, logged_by, actions_taken)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [wo.id, wo.equipment_id, wo.fault_code, wo.severity, wo.status, wo.parts_required, wo.logged_by, wo.actions_taken]);
    }
    console.log('Sample work orders verified.');

    // 9. Seed sample voice transcripts
    const sampleTranscripts = [
      {
        id: '77777777-7777-7777-7777-777777777777',
        work_order_id: '99999999-9999-9999-9999-999999999999',
        raw_transcript: 'Turbine Generator T-402 has a massive oil leak from the casing seal. Need an immediate replacement gasket.',
        confidence_score: 0.950,
        exception_flag: false,
        audio_storage_url: '/uploads/T-402-leak.ogg'
      },
      {
        id: '66666666-6666-6666-6666-666666666666',
        work_order_id: '88888888-8888-8888-8888-888888888888',
        raw_transcript: 'Water pump P-101 is vibrating. Could be cavitation or misalignment.',
        confidence_score: 0.620,
        exception_flag: true,
        audio_storage_url: '/uploads/P-101-vib.ogg'
      }
    ];

    for (const tr of sampleTranscripts) {
      await db.query(`
        INSERT INTO voice_transcripts (id, work_order_id, raw_transcript, confidence_score, exception_flag, audio_storage_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [tr.id, tr.work_order_id, tr.raw_transcript, tr.confidence_score, tr.exception_flag, tr.audio_storage_url]);
    }
    console.log('Sample voice transcripts verified.');

    console.log('Database initialization and seeding complete.');
  } catch (err) {
    console.error('Error during database initialization:', err.message);
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  initDb();
}

module.exports = initDb;
