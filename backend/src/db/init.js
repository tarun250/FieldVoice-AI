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

    // Create voice_transcripts table
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

    // Reset database data
    console.log('Resetting database data (Truncating tables)...');
    await db.query('TRUNCATE TABLE voice_transcripts, work_orders, equipment, workers CASCADE');

    // 5. Seed workers
    const workers = [
      { id: 'e3b0c442-98fc-1111-b303-0242ac120002', username: 'jdoe', fullName: 'John Doe', role: 'technician' },
      { id: 'e3b0c442-98fc-2222-b303-0242ac120002', username: 'sconnor', fullName: 'Sarah Connor', role: 'technician' },
      { id: 'e3b0c442-98fc-3333-b303-0242ac120002', username: 'dmiller', fullName: 'David Miller', role: 'technician' },
      { id: 'e3b0c442-98fc-4444-b303-0242ac120002', username: 'areed', fullName: 'Alex Reed', role: 'supervisor' }
    ];

    for (const w of workers) {
      await db.query(`
        INSERT INTO workers (id, username, full_name, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO NOTHING
      `, [w.id, w.username, w.fullName, w.role]);
    }
    console.log('Seeded workers.');

    // 6. Seed equipment (20 industrial items)
    const equipments = [
      { id: '11111111-1111-1111-1111-111111111111', tag: 'T-402', name: 'Turbine Generator T-402', location: 'Section A' },
      { id: '22222222-2222-2222-2222-222222222222', tag: 'P-101', name: 'Water Circulating Pump P-101', location: 'Section B' },
      { id: '33333333-3333-3333-3333-333333333333', tag: 'V-99', name: 'Main Steam Isolation Valve V-99', location: 'Section C' },
      { id: '44444444-4444-4444-4444-444444444444', tag: 'GEN-501', name: 'Emergency Generator GEN-501', location: 'Section D' },
      { id: '55555555-5555-5555-5555-555555555555', tag: 'BOILER-3', name: 'Steam Boiler BOILER-3', location: 'Section E' },
      { id: '66666666-6666-6666-6666-666666666666', tag: 'COMP-7A', name: 'Centrifugal Air Compressor COMP-7A', location: 'Basement Sump' },
      { id: '77777777-7777-7777-7777-777777777777', tag: 'HX-204', name: 'Shell & Tube Heat Exchanger HX-204', location: 'Section F' },
      { id: '88888888-8888-8888-8888-888888888888', tag: 'XFRM-10', name: 'Main Power Transformer XFRM-10', location: 'Yard East' },
      { id: '99999999-9999-9999-9999-999999999999', tag: 'ELEC-PANEL-B2', name: 'Distribution Board B2', location: 'Control Room' },
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tag: 'CONV-12', name: 'Main Coal Conveyor Belt CONV-12', location: 'Coal Silo' },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', tag: 'CRUSHER-1', name: 'Primary Jaw Crusher CRUSHER-1', location: 'Quarry Pit' },
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', tag: 'BLOWER-8', name: 'Flue Gas Blower BLOWER-8', location: 'Stack Area' },
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', tag: 'T-105', name: 'Gas Turbine T-105', location: 'Turbine Hall B' },
      { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', tag: 'P-303', name: 'Fuel Transfer Pump P-303', location: 'Tank Farm' },
      { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', tag: 'V-102', name: 'Pressure Relief Valve V-102', location: 'Steam Line Header' },
      { id: '00000000-0000-0000-0000-000000000001', tag: 'REG-12', name: 'Gas Flow Regulator REG-12', location: 'Metering Station' },
      { id: '00000000-0000-0000-0000-000000000002', tag: 'HX-205', name: 'Cooling Tower Exchanger HX-205', location: 'Roof North' },
      { id: '00000000-0000-0000-0000-000000000003', tag: 'UPS-3', name: 'Uninterruptible Power Supply UPS-3', location: 'Substation 4' },
      { id: '00000000-0000-0000-0000-000000000004', tag: 'GEN-502', name: 'Standby Generator GEN-502', location: 'Section H' },
      { id: '00000000-0000-0000-0000-000000000005', tag: 'COMP-7B', name: 'Reciprocating Compressor COMP-7B', location: 'Basement Room 2' }
    ];

    for (const eq of equipments) {
      await db.query(`
        INSERT INTO equipment (id, tag, name, location)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tag) DO NOTHING
      `, [eq.id, eq.tag, eq.name, eq.location]);
    }
    console.log('Seeded equipment.');

    // 7. Seed 20 realistic work orders
    const sampleWorkOrders = [
      {
        id: '10000000-0000-0000-0000-000000000001',
        equipment_id: '11111111-1111-1111-1111-111111111111',
        fault_code: 'F-LEAK-OIL',
        severity: 'CRITICAL',
        status: 'OPEN',
        parts_required: ['Gasket', 'Sealant'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000002',
        equipment_id: '22222222-2222-2222-2222-222222222222',
        fault_code: 'F-MECH-VIB',
        severity: 'MEDIUM',
        status: 'IN_PROGRESS',
        parts_required: ['Ball Bearing'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: 'Greased outer casing joints'
      },
      {
        id: '10000000-0000-0000-0000-000000000003',
        equipment_id: '33333333-3333-3333-3333-333333333333',
        fault_code: 'F-VALVE-FAIL',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Actuator Kit'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000004',
        equipment_id: '44444444-4444-4444-4444-444444444444',
        fault_code: 'F-ELEC-START',
        severity: 'CRITICAL',
        status: 'OPEN',
        parts_required: ['Starter Motor', '12V Battery'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000005',
        equipment_id: '55555555-5555-5555-5555-555555555555',
        fault_code: 'F-TEMP-HIGH',
        severity: 'HIGH',
        status: 'RESOLVED',
        parts_required: ['Thermocouple sensor'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: 'Replaced the faulty thermocouple sensor'
      },
      {
        id: '10000000-0000-0000-0000-000000000006',
        equipment_id: '66666666-6666-6666-6666-666666666666',
        fault_code: 'F-COMP-PRES',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Air Filter', 'Pressure Valve'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000007',
        equipment_id: '77777777-7777-7777-7777-777777777777',
        fault_code: 'F-FLOW-BLOCK',
        severity: 'MEDIUM',
        status: 'CLOSED',
        parts_required: ['Flange Gasket'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: 'Backflushed shell side and replaced corroded flange gasket'
      },
      {
        id: '10000000-0000-0000-0000-000000000008',
        equipment_id: '88888888-8888-8888-8888-888888888888',
        fault_code: 'F-ELEC-INSUL',
        severity: 'CRITICAL',
        status: 'OPEN',
        parts_required: ['Transformer Oil'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000009',
        equipment_id: '99999999-9999-9999-9999-999999999999',
        fault_code: 'F-ELEC-BREAKER',
        severity: 'MEDIUM',
        status: 'IN_PROGRESS',
        parts_required: ['100A Circuit Breaker'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: 'Inspected with thermal camera'
      },
      {
        id: '10000000-0000-0000-0000-000000000010',
        equipment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        fault_code: 'F-MECH-MISALIGN',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Return Idler Roller'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000011',
        equipment_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fault_code: 'F-MECH-WEAR',
        severity: 'HIGH',
        status: 'IN_PROGRESS',
        parts_required: ['Jaw Plate Bolt', 'Toggle Plate'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: 'Shut down equipment'
      },
      {
        id: '10000000-0000-0000-0000-000000000012',
        equipment_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        fault_code: 'F-MOTOR-TEMP',
        severity: 'HIGH',
        status: 'RESOLVED',
        parts_required: ['Motor Fan Cover'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: 'Cleaned fan cover and reset overload'
      },
      {
        id: '10000000-0000-0000-0000-000000000013',
        equipment_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        fault_code: 'F-FUEL-LEAK',
        severity: 'CRITICAL',
        status: 'OPEN',
        parts_required: ['Fuel Line Seal O-ring'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: 'Shut down turbine manually'
      },
      {
        id: '10000000-0000-0000-0000-000000000014',
        equipment_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        fault_code: 'F-LEAK-SEAL',
        severity: 'MEDIUM',
        status: 'OPEN',
        parts_required: ['Pump Mechanical Seal'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000015',
        equipment_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        fault_code: 'F-VALVE-LEAK',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Valve Seat ring'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000016',
        equipment_id: '00000000-0000-0000-0000-000000000001',
        fault_code: 'F-FLOW-FLUC',
        severity: 'MEDIUM',
        status: 'RESOLVED',
        parts_required: ['Regulator Diaphragm'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: 'Replaced ruptured control diaphragm'
      },
      {
        id: '10000000-0000-0000-0000-000000000017',
        equipment_id: '00000000-0000-0000-0000-000000000002',
        fault_code: 'F-HX-LEAK',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Tube Plugs'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      },
      {
        id: '10000000-0000-0000-0000-000000000018',
        equipment_id: '00000000-0000-0000-0000-000000000003',
        fault_code: 'F-BATT-FAIL',
        severity: 'HIGH',
        status: 'IN_PROGRESS',
        parts_required: ['UPS Battery Module'],
        logged_by: 'e3b0c442-98fc-2222-b303-0242ac120002',
        actions_taken: 'Conducted cell impedance testing'
      },
      {
        id: '10000000-0000-0000-0000-000000000019',
        equipment_id: '00000000-0000-0000-0000-000000000004',
        fault_code: 'F-COOL-LEAK',
        severity: 'MEDIUM',
        status: 'RESOLVED',
        parts_required: ['Radiator Hose', 'Hose Clamp'],
        logged_by: 'e3b0c442-98fc-3333-b303-0242ac120002',
        actions_taken: 'Replaced radiator hose and hose clamp, refilled coolant'
      },
      {
        id: '10000000-0000-0000-0000-000000000020',
        equipment_id: '55555555-5555-5555-5555-555555555555',
        fault_code: 'F-BURN-MISFIRE',
        severity: 'HIGH',
        status: 'OPEN',
        parts_required: ['Ignition Electrode', 'Flame Scanner'],
        logged_by: 'e3b0c442-98fc-1111-b303-0242ac120002',
        actions_taken: null
      }
    ];

    for (const wo of sampleWorkOrders) {
      await db.query(`
        INSERT INTO work_orders (id, equipment_id, fault_code, severity, status, parts_required, logged_by, actions_taken)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [wo.id, wo.equipment_id, wo.fault_code, wo.severity, wo.status, wo.parts_required, wo.logged_by, wo.actions_taken]);
    }
    console.log('Seeded work orders.');

    // 8. Seed 20 realistic voice transcripts matching the work orders
    const sampleTranscripts = [
      {
        id: '20000000-0000-0000-0000-000000000001',
        work_order_id: '10000000-0000-0000-0000-000000000001',
        raw_transcript: 'Turbine Generator T-402 has a massive oil leak from the casing seal. Need an immediate replacement gasket.',
        confidence_score: 0.950,
        exception_flag: false,
        audio_storage_url: '/uploads/T-402-leak.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000002',
        work_order_id: '10000000-0000-0000-0000-000000000002',
        raw_transcript: 'Water pump P-101 is vibrating excessively under load. Greased the outer casing joints but need a new ball bearing.',
        confidence_score: 0.880,
        exception_flag: false,
        audio_storage_url: '/uploads/P-101-vib.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000003',
        work_order_id: '10000000-0000-0000-0000-000000000003',
        raw_transcript: 'Main steam isolation valve V-99 is failing to stroke fully closed. Pneumatic actuator seal is hissed. Requesting actuator kit.',
        confidence_score: 0.910,
        exception_flag: false,
        audio_storage_url: '/uploads/V-99-fail.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000004',
        work_order_id: '10000000-0000-0000-0000-000000000004',
        raw_transcript: 'Emergency generator 501 failed to crank during monthly test. Battery voltage is normal but starter solenoid clicks. Replace starter motor.',
        confidence_score: 0.890,
        exception_flag: false,
        audio_storage_url: '/uploads/GEN-501-starter.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000005',
        work_order_id: '10000000-0000-0000-0000-000000000005',
        raw_transcript: 'Steam boiler 3 high temperature trip activated. Replaced the faulty thermocouple sensor, temperature is back to normal now.',
        confidence_score: 0.960,
        exception_flag: false,
        audio_storage_url: '/uploads/BOILER-3-temp.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000006',
        work_order_id: '10000000-0000-0000-0000-000000000006',
        raw_transcript: 'Centrifugal air compressor 7A output pressure is low. Noticed a high pressure drop across the intake filter. Need replacement filter element.',
        confidence_score: 0.650,
        exception_flag: true,
        audio_storage_url: '/uploads/COMP-7A-pressure.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000007',
        work_order_id: '10000000-0000-0000-0000-000000000007',
        raw_transcript: 'Exchanger 204 showing low thermal transfer efficiency. Backflushed the shell side and replaced the corroded flange gasket.',
        confidence_score: 0.940,
        exception_flag: false,
        audio_storage_url: '/uploads/HX-204-block.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000008',
        work_order_id: '10000000-0000-0000-0000-000000000008',
        raw_transcript: 'Main power transformer 10 gas analysis shows elevated acetylene levels. Insulation degradation suspected. Need oil filtration.',
        confidence_score: 0.920,
        exception_flag: false,
        audio_storage_url: '/uploads/XFRM-10-gas.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000009',
        work_order_id: '10000000-0000-0000-0000-000000000009',
        raw_transcript: 'Distribution board B2 has a tripped main circuit breaker. Hotspot detected with thermal camera on L3 phase. Replacing breaker.',
        confidence_score: 0.580,
        exception_flag: true,
        audio_storage_url: '/uploads/ELEC-PANEL-B2-breaker.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000010',
        work_order_id: '10000000-0000-0000-0000-000000000010',
        raw_transcript: 'Main coal conveyor belt 12 is tracking to the left. Damaged return idler roller at frame station 45. Roller needs replacement.',
        confidence_score: 0.870,
        exception_flag: false,
        audio_storage_url: '/uploads/CONV-12-misalignment.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000011',
        work_order_id: '10000000-0000-0000-0000-000000000011',
        raw_transcript: 'Primary jaw crusher 1 toggle plate cracked. Equipment shut down. Need replacement toggle plate and heavy-duty jaw plate bolts.',
        confidence_score: 0.930,
        exception_flag: false,
        audio_storage_url: '/uploads/CRUSHER-1-wear.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000012',
        work_order_id: '10000000-0000-0000-0000-000000000012',
        raw_transcript: 'Flue gas blower 8 motor cooling fan cover is clogged with dust causing high temperatures. Cleaned and reset overload.',
        confidence_score: 0.900,
        exception_flag: false,
        audio_storage_url: '/uploads/BLOWER-8-temp.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000013',
        work_order_id: '10000000-0000-0000-0000-000000000013',
        raw_transcript: 'Gas turbine 105 fuel line connection is leaking diesel fuel. Shut down turbine manually. Replacement fuel line seal required.',
        confidence_score: 0.950,
        exception_flag: false,
        audio_storage_url: '/uploads/T-105-leak.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000014',
        work_order_id: '10000000-0000-0000-0000-000000000014',
        raw_transcript: 'Fuel transfer pump 303 mechanical shaft seal is leaking fuel on the baseplate. Need a replacement mechanical seal.',
        confidence_score: 0.860,
        exception_flag: false,
        audio_storage_url: '/uploads/P-303-seal.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000015',
        work_order_id: '10000000-0000-0000-0000-000000000015',
        raw_transcript: 'Pressure relief valve 102 is simmering and leaking steam below set pressure. Seat ring is pitted. Require seat ring replacement.',
        confidence_score: 0.610,
        exception_flag: true,
        audio_storage_url: '/uploads/V-102-leak.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000016',
        work_order_id: '10000000-0000-0000-0000-000000000016',
        raw_transcript: 'Gas flow regulator 12 outlet pressure fluctuating. Replaced ruptured control diaphragm, gas pressure is stable now.',
        confidence_score: 0.970,
        exception_flag: false,
        audio_storage_url: '/uploads/REG-12-fluctuation.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000017',
        work_order_id: '10000000-0000-0000-0000-000000000017',
        raw_transcript: 'Cooling tower exchanger 205 has internal tube leaks resulting in product contamination. Need tube plugs to isolate leaking tubes.',
        confidence_score: 0.920,
        exception_flag: false,
        audio_storage_url: '/uploads/HX-205-leak.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000018',
        work_order_id: '10000000-0000-0000-0000-000000000018',
        raw_transcript: 'Uninterruptible power supply 3 battery bank shows cell mismatch warning. Two modules failed impedance test. Replacement battery needed.',
        confidence_score: 0.940,
        exception_flag: false,
        audio_storage_url: '/uploads/UPS-3-battery.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000019',
        work_order_id: '10000000-0000-0000-0000-000000000019',
        raw_transcript: 'Standby generator 502 has a coolant leak at the upper radiator hose bypass. Replaced the hose and clamp and refilled coolant.',
        confidence_score: 0.950,
        exception_flag: false,
        audio_storage_url: '/uploads/GEN-502-coolant.ogg'
      },
      {
        id: '20000000-0000-0000-0000-000000000020',
        work_order_id: '10000000-0000-0000-0000-000000000020',
        raw_transcript: 'Steam boiler 3 burner failed to light. Ignition electrode is fouled and flame scanner lens is dirty. Need replacement electrode.',
        confidence_score: 0.690,
        exception_flag: true,
        audio_storage_url: '/uploads/BOILER-3-burner.ogg'
      }
    ];

    for (const tr of sampleTranscripts) {
      await db.query(`
        INSERT INTO voice_transcripts (id, work_order_id, raw_transcript, confidence_score, exception_flag, audio_storage_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [tr.id, tr.work_order_id, tr.raw_transcript, tr.confidence_score, tr.exception_flag, tr.audio_storage_url]);
    }
    console.log('Seeded voice transcripts.');

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
