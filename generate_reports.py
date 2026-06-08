import json
import random

# Seed for reproducibility of the test dataset
random.seed(42)

equipments = [
    {"id": "T-402", "name": "Turbine Generator T-402"},
    {"id": "P-101", "name": "Water Pump P-101"},
    {"id": "P-204", "name": "Lube Oil Pump P-204"},
    {"id": "V-312", "name": "Bypass Valve V-312"},
    {"id": "GEN-501", "name": "Emergency Generator GEN-501"},
    {"id": "COMP-7A", "name": "Air Compressor COMP-7A"},
    {"id": "V-99", "name": "Main Isolation Valve V-99"},
    {"id": "T-102", "name": "Cooling Tower Fan T-102"},
    {"id": "HYD-88", "name": "Hydraulic Power Pack HYD-88"},
    {"id": "BOILER-3", "name": "Steam Boiler BOILER-3"}
]

locations = [
    "Turbine Room B", "Basement Sump", "North Yard", "Compressor Shed",
    "Substation 3", "Boiler Room Hallway", "Roof Deck Area 2", 
    "Hydraulics Bay", "Valve Pit 4", "Auxiliary Pump Room"
]

faults = [
    {"code": "F-LEAK-OIL", "description": "Lube oil leakage", "severity": "High"},
    {"code": "F-MECH-VIB", "description": "Excessive shaft vibration", "severity": "High"},
    {"code": "F-ELEC-SHORT", "description": "Stator winding short circuit", "severity": "Critical"},
    {"code": "F-THERM-HOT", "description": "Bearing temperature overload", "severity": "Critical"},
    {"code": "F-HYD-PRESS", "description": "Loss of system pressure", "severity": "Medium"},
    {"code": "F-STRUCT-CRACK", "description": "Structural housing crack", "severity": "High"},
    {"code": "F-MECH-WEAR", "description": "Extreme gear backlash/wear", "severity": "Medium"},
    {"code": "F-ELEC-CALIBR", "description": "RTD sensor calibration drift", "severity": "Low"}
]

actions = [
    "Isolated and shut down unit manually",
    "Replaced flange gasket and tightened bolts",
    "Lubricated bearings and adjusted drive belt tension",
    "Re-calibrated RTD temperature sensor",
    "Closed bypass valve and verified pressure drop",
    "Patched outer housing with temporary casing plate",
    "Refilled hydraulic fluid reservoir and checked seals",
    "Cleaned air filter and blew out lines"
]

parts = [
    "Flange Gasket", "Seal Kit", "Ball Bearing", "RTD Sensor", 
    "Drive Belt", "Casing Plate", "Hydraulic Fluid", "O-Ring"
]

noise_tokens = ["[static]", "[clanking]", "[hissing]", "[background chatter]", "uh", "um", "ah", "like", "well"]

stutters = {
    "pump": ["p-pump", "p... pump", "pump"],
    "turbine": ["t-turbine", "t... turbine", "turbine"],
    "generator": ["g-generator", "g... generator", "generator"],
    "valve": ["v-valve", "v... valve", "valve"],
    "compressor": ["c-compressor", "c... compressor", "compressor"]
}

jargon = [
    "cavitation sound", "armature winding", "backlash play", "impeller wear", 
    "differential pressure drop", "insulation resistance", "shaft misalignment", 
    "fluid degradation", "valve packing leak", "stator core"
]

def make_noisy_word(word):
    word_lower = word.lower()
    for key, val in stutters.items():
        if key in word_lower:
            return random.choice(val)
    return word

def generate_report(idx):
    equip = random.choice(equipments)
    loc = random.choice(locations)
    fault = random.choice(faults)
    action = random.choice(actions)
    
    # Pick 0 to 2 parts required
    num_parts = random.choice([0, 1, 2])
    req_parts = random.sample(parts, num_parts) if num_parts > 0 else []
    
    # Generate noisy, conversational transcripts
    templates = [
        # Template 1: Normal but stuttered, with noise
        f"hey, {random.choice(noise_tokens)}... this is report {idx}. we are at {loc}. inspecting {make_noisy_word(equip['name'])} which is {equip['id']}. "
        f"there is a {fault['description']}. code is {fault['code']}. severity is {fault['severity']}. "
        f"what I did: {action}. we will need {', '.join(req_parts) if req_parts else 'no parts'}.",
        
        # Template 2: Incomplete sentences, frantic
        f"{make_noisy_word(equip['id'])} in {loc} is acting up. {random.choice(noise_tokens)}... a lot of {random.choice(jargon)}. "
        f"looks like {fault['description']}. fault code {fault['code']}. {random.choice(noise_tokens)} severity {fault['severity']}. "
        f"I just {action}. need some... {', '.join(req_parts) if req_parts else 'nothing'} for it.",
        
        # Template 3: Background clanking, numbers spoken as words, short cut-off
        f"{random.choice(noise_tokens)} {equip['id']} at {loc} has {fault['description']}. severe {random.choice(jargon)}. "
        f"code is {fault['code'].lower().replace('-', ' ')}. severity level {fault['severity'].lower()}. "
        f"did a quick fix: {action}. {random.choice(noise_tokens)}... need {', '.join(req_parts) if req_parts else 'no parts'} to finish it.",
        
        # Template 4: Conversational, rambling, phonetic equipment names
        f"ok so, checking in from {loc}. the {make_noisy_word(equip['name'])}... that's {equip['id'].replace('-', ' ')}... has a major issue. "
        f"it's got {fault['description']}. code {fault['code']}. severity is definitely {fault['severity']}. "
        f"{random.choice(noise_tokens)}... I had to {action}. make sure to order {', '.join(req_parts) if req_parts else 'no extra parts'}."
    ]
    
    raw_transcript = random.choice(templates)
    
    # Add random noise particles
    words = raw_transcript.split()
    for _ in range(random.randint(1, 3)):
        insert_pos = random.randint(0, len(words))
        words.insert(insert_pos, random.choice(noise_tokens))
    
    raw_transcript = " ".join(words)
    # Cleanup double spaces
    raw_transcript = " ".join(raw_transcript.split())
    
    return {
        "id": idx,
        "raw_transcript": raw_transcript,
        "ground_truth": {
            "equipment_id": equip["id"],
            "location": loc,
            "fault_code": fault["code"],
            "severity": fault["severity"],
            "maintenance_action": action,
            "parts_required": req_parts
        }
    }

dataset = [generate_report(i) for i in range(1, 101)]

output_path = "c:/Users/dhruv/Desktop/FieldVoice AI/test_voice_reports.json"
with open(output_path, "w") as f:
    json.dump(dataset, f, indent=2)

print(f"Successfully generated 100 voice reports and saved to {output_path}")
