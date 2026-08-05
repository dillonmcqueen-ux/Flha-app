// src/equipmentInspectionTemplates.js
// Real, fixed pre-trip inspection checklists per equipment type, modeled on
// the company's paper daily-equipment-inspection forms (hydraulic excavator,
// wheel loader, etc.) — replacing the old approach of asking an LLM to
// improvise a checklist per machine, which produced inconsistent, sometimes
// thin results. A truck's checklist should never look like a grader's.

function items(category, list) {
  return list.map(item => ({ item, category }));
}

const EQUIPMENT_TEMPLATES = {
  EXCAVATOR: {
    label: "Hydraulic Excavator",
    items: [
      ...items("Walkaround / Structure", [
        "Counterweight and body — damage, cracks",
        "Compartment doors, coolant, batteries, and disconnect switch",
        "Radiators, coolers, and condensers",
        "Undercarriage: track adjustment and wear, tires (if wheeled)",
        "Tracks (or wheels, if wheeled) clean, free of debris, nothing wrapped around them",
        "Pads, rollers, idlers, sprockets — bolts/bushings, final drives",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Hydraulic fluid level",
        "Coolant level",
        "Belts, pulleys, hoses, radiator fins",
        "Alternator, starter, wiring harness",
        "Air filter / restriction gauge, filter body, induction system",
        "Fuel system, turbo, and exhaust",
        "Crankcase breather and valve cover",
      ]),
      ...items("Hydraulics & Attachment", [
        "Boom cylinders, hoses, and pins",
        "Stick linkage, hoses, and pins",
        "Bucket / grapple cylinders, hoses, pins, and attachments",
        "Swing drive, swing motor, and swing gear fluid",
        "Visible hydraulic leaks at fittings and quick-connects",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, doors, and glass condition",
        "Mirrors and camera (if equipped)",
        "Seat belt condition and latch",
        "Gauges and monitoring system on start-up",
        "Travel alarm and horn",
        "Fire extinguisher / fire suppression system present and charged",
        "Hydraulic cut-out / lockout lever function",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine (approx. 10 minutes) before full load work",
        "Test hydraulic cut-out under load",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  WHEEL_LOADER: {
    label: "Wheel Loader",
    items: [
      ...items("Walkaround / Structure", [
        "Tires, wheels, lug nuts, and locks",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Hand rails, steps, sheet metal, door latches, fenders, frame",
        "Radiator grill guard, fan, motor, hoses, lights",
        "Underneath machine: belly pans and differential",
        "Articulation area: joints, pins, steering cylinders/rods",
        "Driveline guards, grease lines/zerks",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Transmission fluid level",
        "Hydraulic fluid level / hydraulic tank",
        "Belts, pulleys, hoses, radiator fins",
        "Alternator, starter, wiring harness",
        "Air filter / restriction gauge, filter body, induction system",
        "Fuel system, turbo, and exhaust",
      ]),
      ...items("Bucket / Attachment", [
        "Bucket cutting edge, teeth, and guards/rack",
        "Bucket lift and tilt cylinders, hoses",
        "Loader frame, arms, and pins",
        "Attachment locking / quick-coupler engagement",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, doors, mirrors, glass",
        "Seat belt, horn, wipers",
        "Gauges, controls, two-way radio",
        "Back-up alarm and camera",
        "Fire extinguisher / fire suppression system present and charged",
        "Lights and wiring guards",
      ]),
      ...items("Pre-Operation Function Test", [
        "Start engine, warm up (approx. 10 minutes)",
        "Test brakes and system operation",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  DOZER: {
    label: "Crawler Dozer",
    items: [
      ...items("Walkaround / Undercarriage", [
        "Tracks: tension, wear, cracked links",
        "Tracks clean, free of debris, nothing wrapped around them",
        "Track pads, rollers, idlers, sprockets — bolts/bushings",
        "Final drives — leaks, damage",
        "Blade, cutting edge, and end bits — wear, cracks",
        "Ripper (if equipped) — shank, tip, cylinders",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Transmission / torque converter fluid level",
        "Hydraulic fluid level",
        "Belts, hoses, radiator fins — leaks or damage",
        "Air filter / restriction gauge",
        "Fuel system, turbo, and exhaust",
      ]),
      ...items("Blade / Hydraulics", [
        "Blade lift and tilt cylinders, hoses, pins",
        "Ripper cylinders and hoses (if equipped)",
        "Visible hydraulic leaks at fittings",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, doors, glass",
        "Seat belt condition and latch",
        "Gauges and monitoring system on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher / fire suppression system present and charged",
        "Steering / tiller controls response",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full load work",
        "Test brakes and steering clutches",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  GRADER: {
    label: "Motor Grader",
    items: [
      ...items("Walkaround / Structure", [
        "Tires, wheels, lug nuts, and locks",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Frame, articulation joint, and hinge pins",
        "Steps, hand rails, sheet metal, fenders",
        "Circle, drawbar, and moldboard — wear, cracks, mounting",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Transmission fluid level",
        "Hydraulic fluid level",
        "Belts, hoses, radiator fins — leaks or damage",
        "Air filter / restriction gauge",
        "Fuel system, turbo, and exhaust",
      ]),
      ...items("Blade & Attachments", [
        "Moldboard cutting edge and end bits — wear",
        "Blade lift, side-shift, and tip cylinders/hoses",
        "Circle drive motor and gearbox",
        "Scarifier / ripper (if equipped)",
        "Front wheel lean cylinder",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, doors, glass",
        "Seat belt condition and latch",
        "Gauges and monitoring system on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
        "Steering response and articulation control",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full load work",
        "Test brakes and steering",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  SKID_STEER: {
    label: "Skid Steer / Compact Track Loader",
    items: [
      ...items("Walkaround / Undercarriage", [
        "Tires or tracks — wear, damage, pressure/tension",
        "Tracks/wheels clean, free of debris, nothing wrapped around them",
        "Lift arms, cylinders, and pivot pins",
        "Attachment plate / quick-coupler and locking pins",
        "Chassis, frame, and cab cage for damage",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic fluid level",
        "Belts, hoses — leaks or damage",
        "Air filter",
      ]),
      ...items("Attachment & Hydraulics", [
        "Bucket / attachment cutting edge and teeth",
        "Attachment hydraulic couplers and hoses",
        "Visible hydraulic leaks at fittings",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, door/bars, seat bar or belt",
        "Seat belt condition and latch",
        "Controls and interlock (seat bar / seat belt) function",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full load work",
        "Test lift arm and attachment function at low load",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  BACKHOE: {
    label: "Backhoe Loader",
    items: [
      ...items("Walkaround / Structure", [
        "Tires, wheels, lug nuts, and locks",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Stabilizer legs/pads — condition and pin wear",
        "Frame, hand rails, steps, fenders",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Transmission fluid level",
        "Hydraulic fluid level",
        "Belts, hoses, radiator fins — leaks or damage",
        "Air filter / restriction gauge",
      ]),
      ...items("Loader & Backhoe Attachment", [
        "Loader bucket cutting edge, lift/tilt cylinders",
        "Backhoe boom, dipper, and bucket cylinders/hoses/pins",
        "Stabilizer cylinders",
        "Visible hydraulic leaks at fittings",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "ROPS/FOPS structure, doors, glass",
        "Seat belt condition and latch",
        "Gauges and monitoring system on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full load work",
        "Test brakes and stabilizer function",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  COMPACTOR: {
    label: "Roller / Compactor",
    items: [
      ...items("Walkaround / Structure", [
        "Drum(s) — dents, cracks, weld condition",
        "Drum/wheels clean, free of debris, nothing wrapped around them",
        "Scraper bars and drum cleanliness",
        "Tires (if pneumatic/combination) — wear and pressure",
        "Frame and articulation joint",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic fluid level",
        "Belts, hoses — leaks or damage",
        "Air filter",
      ]),
      ...items("Vibration System", [
        "Vibration motor / exciter — leaks, mounting",
        "Water spray system for drum (if equipped)",
      ]),
      ...items("Cab/Platform, Controls & Safety Devices", [
        "ROPS structure and platform condition",
        "Seat belt condition and latch",
        "Gauges and monitoring system on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full operation",
        "Test propulsion and vibration engagement",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  DUMP_TRUCK: {
    label: "Haul / Dump Truck",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Box/bed — cracks, damage, tailgate latch",
        "Frame, suspension, and mud flaps",
        "Mirrors, lights, and reflectors",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic (hoist) fluid level",
        "Belts, hoses — leaks or damage",
        "Air filter",
        "Fuel system and exhaust",
      ]),
      ...items("Hoist / Box", [
        "Hoist cylinder and hoses",
        "Box props / safety props in place and functional",
        "Tailgate operation and locking mechanism",
      ]),
      ...items("Brakes & Air System", [
        "Service brake function/pedal feel",
        "Parking brake function",
        "Air system pressure build-up and low-air warning (if air brakes)",
        "Air lines and connections for leaks",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "Seat belt condition and latch",
        "Gauges and warning lights on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
        "Wipers, horn, and steering",
      ]),
      ...items("Pre-Operation Function Test", [
        "Test brakes before moving",
        "Check load securement / tailgate before travel",
      ]),
    ],
  },

  // The three trailer templates below are all TOWED, unpowered equipment —
  // no engine, no engine oil, no fuel system. Their "hydraulic system"
  // items refer to a self-contained pump (battery or PTO-driven off the
  // tow vehicle), not an onboard engine, which is the mistake that put
  // engine-oil checks on a 5x10 dump trailer in the first place.
  DUMP_TRAILER: {
    label: "Dump Trailer",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Frame, box, and tailgate — cracks, damage, weld condition",
        "Fenders, mud flaps, and steps",
      ]),
      ...items("Hitch & Running Gear", [
        "Coupler/hitch — condition, locking pin/latch",
        "Safety chains — condition and properly crossed",
        "Breakaway cable and battery (if equipped)",
        "Jack/landing gear (if equipped) — condition and function",
        "Axles, springs/suspension, and brakes",
      ]),
      ...items("Dump / Hydraulic System", [
        "Dump mechanism (hoist cylinder or bottom-dump gate/apron) — condition and operation",
        "Hydraulic hoses and fittings — leaks or damage",
        "Hydraulic pump / power unit (battery or PTO-driven) — condition",
        "Hydraulic fluid level (if self-contained reservoir)",
        "Tailgate — latch, chains, and swing/barn-door operation",
      ]),
      ...items("Electrical & Lighting", [
        "Trailer lights, marker lights, and reflectors — function",
        "Electrical connector/pigtail — condition, no exposed wires",
        "Wiring harness — secured, no chafe points",
      ]),
      ...items("Brakes & Safety Devices", [
        "Trailer brake function (electric or hydraulic surge, as equipped)",
        "Breakaway brake test",
        "Warning triangles/flares present",
      ]),
      ...items("Pre-Operation Function Test", [
        "Test dump cycle (raise/lower) before loading",
        "Confirm tailgate secures properly before travel",
        "Confirm load rating not exceeded",
      ]),
    ],
  },

  WALKING_FLOOR_TRAILER: {
    label: "Walking Floor / Live Floor Trailer",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Frame, side walls, and floor slats — cracks, damage, wear",
        "Tarp system — condition and operation (if equipped)",
        "Rear gate/door — condition and latch",
      ]),
      ...items("Hitch & Running Gear", [
        "Coupler/hitch — condition, locking pin/latch",
        "Safety chains — condition and properly crossed",
        "Landing gear — condition and function",
        "Axles, springs/suspension, and brakes",
      ]),
      ...items("Walking Floor Hydraulic System", [
        "Hydraulic drive cylinders and slat drive mechanism — condition",
        "Hydraulic hoses, fittings, and pump — leaks or damage",
        "Hydraulic fluid level (trailer reservoir or tow vehicle, as applicable)",
        "Floor slats — alignment, wear strips, and slide condition",
      ]),
      ...items("Electrical & Lighting", [
        "Trailer lights, marker lights, and reflectors — function",
        "Electrical connector/pigtail — condition, no exposed wires",
      ]),
      ...items("Brakes & Safety Devices", [
        "Trailer brake function",
        "Breakaway brake test",
        "Warning triangles/flares present",
      ]),
      ...items("Pre-Operation Function Test", [
        "Test walking floor unload cycle before loading",
        "Confirm rear gate/door secures properly before travel",
        "Confirm load rating not exceeded",
      ]),
    ],
  },

  EQUIPMENT_TRAILER: {
    label: "Equipment / Flatdeck / Utility Trailer",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Deck, ramps, and frame — cracks, damage, wear",
        "Fenders and mud flaps",
      ]),
      ...items("Hitch & Running Gear", [
        "Coupler/hitch — condition, locking pin/latch",
        "Safety chains — condition and properly crossed",
        "Landing gear/jack — condition and function",
        "Axles, springs/suspension, and brakes",
      ]),
      ...items("Load Securement", [
        "Tie-down points, chains, and binders — condition",
        "Ramps — condition, operation, and stowed/secured for travel",
        "Load rating not exceeded, weight distributed properly",
      ]),
      ...items("Electrical & Lighting", [
        "Trailer lights, marker lights, and reflectors — function",
        "Electrical connector/pigtail — condition, no exposed wires",
      ]),
      ...items("Brakes & Safety Devices", [
        "Trailer brake function",
        "Breakaway brake test",
        "Warning triangles/flares present",
      ]),
    ],
  },

  WATER_TRUCK: {
    label: "Water Truck",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Tank — leaks, mounting, baffles",
        "Frame, suspension, and mud flaps",
        "Mirrors, lights, and reflectors",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Belts, hoses — leaks or damage",
        "Air filter",
        "Fuel system and exhaust",
      ]),
      ...items("Water System", [
        "Water pump — leaks, drive belt/PTO condition",
        "Spray bars / nozzles and valves — function and leaks",
        "Fill port, hose, and cap condition",
        "Tank level sight gauge",
      ]),
      ...items("Brakes & Safety Devices", [
        "Service and parking brake function",
        "Air system pressure build-up and low-air warning (if air brakes)",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Test brakes before moving",
        "Test spray system function",
      ]),
    ],
  },

  SEMI_TRUCK: {
    label: "Semi / Tractor-Trailer",
    items: [
      ...items("Walkaround / Tractor", [
        "Tires — tread, pressure, damage, wheel nuts (all axles)",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Frame, fuel tanks, and mud flaps",
        "Fifth wheel — locking jaw, release arm, mounting, and lubrication",
        "Steps, grab handles, mirrors, and glass",
        "Lights, reflectors, and marker lights (tractor)",
      ]),
      ...items("Trailer & Coupling", [
        "Trailer coupling — kingpin engagement and locking pins",
        "Air lines and electrical (glad hands/pigtail) connections — secure, no leaks",
        "Landing gear — fully raised and secured",
        "Trailer tires, wheels, and mud flaps",
        "Trailer lights, reflectors, and marker lights",
        "Load secured — straps, chains, or tarps as required",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Windshield washer fluid",
        "Belts and hoses — leaks or damage",
        "Fuel and DEF levels",
      ]),
      ...items("Brakes & Air System", [
        "Air system pressure build-up and low-air warning",
        "Air lines and connections for leaks (tractor and trailer)",
        "Service brake function/pedal feel",
        "Parking/trailer brake function",
        "ABS warning light function",
      ]),
      ...items("Cab & Safety Devices", [
        "Seat belt condition and latch",
        "Gauges and warning lights on start-up",
        "Horn and wipers",
        "Fire extinguisher, warning triangles/flares, and first aid kit present",
      ]),
      ...items("Documentation & Pre-Trip", [
        "Log book / ELD present and current",
        "Registration, insurance, and permits on board",
        "Defects noted on the last trip's inspection report have been corrected",
      ]),
    ],
  },

  PICKUP_TRUCK: {
    label: "Pickup Truck",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Body damage, mirrors, glass, wipers",
        "Lights, signals, and reflectors",
        "Spare tire, jack, and lug wrench present",
        "Trailer hitch, wiring, and safety chains (if towing)",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Windshield washer fluid",
        "Belts and hoses — leaks or damage",
      ]),
      ...items("Brakes & Steering", [
        "Service brake function/pedal feel",
        "Parking brake function",
        "Steering response, no excess play",
      ]),
      ...items("Cab & Safety Devices", [
        "Seat belts — all positions",
        "Gauges and warning lights on start-up",
        "Horn and wipers",
        "Fire extinguisher and first aid kit present",
      ]),
      ...items("Cargo & Load", [
        "Truck bed / cargo area — tie-downs, load secured",
        "Tailgate latch function",
      ]),
    ],
  },

  SERVICE_TRUCK: {
    label: "Service / Deck Truck",
    items: [
      ...items("Walkaround / Structure", [
        "Tires — tread, pressure, damage, wheel nuts",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Body damage, mirrors, glass, wipers",
        "Lights, signals, and reflectors",
        "Deck / service box — condition, tie-downs, secured equipment",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Windshield washer fluid",
        "Belts and hoses — leaks or damage",
      ]),
      ...items("Brakes & Steering", [
        "Service brake function/pedal feel",
        "Parking brake function",
        "Steering response, no excess play",
      ]),
      ...items("Cab & Safety Devices", [
        "Seat belts — all positions",
        "Gauges and warning lights on start-up",
        "Horn and wipers",
        "Fire extinguisher and first aid kit present",
      ]),
      ...items("Deck / Service Equipment", [
        "Crane/hoist, compressor, or welder mounting and function",
        "Outrigger/stabilizer function (if crane-equipped)",
        "Fuel/oil transfer tank and hoses — leaks, cap condition",
      ]),
    ],
  },

  CRANE: {
    label: "Crane / Boom Truck",
    items: [
      ...items("Walkaround / Structure", [
        "Tires (if mobile) — tread, pressure, damage",
        "Wheels/tracks clean, free of debris, nothing wrapped around them",
        "Outriggers / stabilizers — pads, cylinders, pins",
        "Frame and carrier body condition",
        "Boom sections — dents, cracks, wear pads",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic fluid level",
        "Belts, hoses — leaks or damage",
      ]),
      ...items("Hoist / Rigging", [
        "Wire rope — kinks, broken strands, wear",
        "Hook and safety latch condition",
        "Load block/ball and sheaves",
        "Load moment indicator / anti-two-block system function",
      ]),
      ...items("Controls & Safety Devices", [
        "Boom angle and length indicators",
        "Load chart present and legible",
        "Outrigger/stabilizer position indicators",
        "Back-up alarm, horn, and beacon",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Test outrigger/stabilizer deployment before lifting",
        "Function-test hoist, boom, and swing at no load",
      ]),
    ],
  },

  AERIAL_LIFT: {
    label: "Aerial / Boom / Scissor Lift",
    items: [
      ...items("Walkaround / Structure", [
        "Tires/wheels — condition and pressure",
        "Wheels/tires clean, free of debris, nothing wrapped around them",
        "Base frame, outriggers/stabilizers — condition",
        "Platform/basket — gate or chain, guardrails, floor",
        "Boom or scissor structure — welds, pins, cracks",
      ]),
      ...items("Fluids & Power Unit", [
        "Engine oil / battery charge level",
        "Hydraulic fluid level",
        "Hoses and fittings — leaks or damage",
      ]),
      ...items("Controls & Safety Devices", [
        "Platform controls and emergency stop function",
        "Ground-level controls and emergency lowering function",
        "Tilt/level alarm and function",
        "Fall protection anchor point(s) in platform",
        "Interlocks (e.g. drive-disable at height, if equipped)",
      ]),
      ...items("Pre-Operation Function Test", [
        "Function-test lift/lower and drive at ground level before use",
        "Confirm harness and lanyard available and inspected",
      ]),
    ],
  },

  TRENCHER: {
    label: "Trencher",
    items: [
      ...items("Walkaround / Structure", [
        "Tires or tracks — wear, damage, pressure/tension",
        "Tracks/wheels clean, free of debris, nothing wrapped around them",
        "Digging chain / wheel — wear, tension, teeth condition",
        "Spoil auger/conveyor condition and guards",
        "Frame and boom condition",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic fluid level",
        "Belts, hoses — leaks or damage",
      ]),
      ...items("Controls & Safety Devices", [
        "Chain/wheel guards and shields in place",
        "Operator presence / dead-man control function",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Confirm utility locates completed before digging",
        "Function-test digging chain/wheel engagement at no load",
        "Grease points serviced per schedule",
      ]),
    ],
  },

  GENERIC: {
    label: "Heavy Equipment (General)",
    items: [
      ...items("Walkaround / Structure", [
        "Tires or tracks — wear, damage, pressure/tension",
        "Tracks/wheels clean, free of debris, nothing wrapped around them",
        "Frame, body panels, and structure for damage",
        "Mirrors, lights, and reflectors",
      ]),
      ...items("Fluids & Engine Compartment", [
        "Engine oil level",
        "Coolant level",
        "Hydraulic fluid level (if equipped)",
        "Belts, hoses — leaks or damage",
        "Air filter",
      ]),
      ...items("Attachment / Work Function", [
        "Attachment or work tool condition and mounting",
        "Visible hydraulic leaks at fittings",
      ]),
      ...items("Cab, Controls & Safety Devices", [
        "Structure (ROPS/FOPS if equipped), doors, glass",
        "Seat belt condition and latch",
        "Gauges and warning lights on start-up",
        "Back-up alarm and horn",
        "Fire extinguisher present and charged",
      ]),
      ...items("Pre-Operation Function Test", [
        "Warm up engine before full load work",
        "Test brakes / steering / core controls",
        "Grease points serviced per schedule",
      ]),
    ],
  },
};

// Ordered most-specific-first so e.g. "Backhoe Loader" matches BACKHOE
// before the generic "loader" pattern, "Skid Steer Loader" matches
// SKID_STEER first, "Service Truck" matches SERVICE_TRUCK, and "Semi
// Truck" matches SEMI_TRUCK, all before the broad PICKUP_TRUCK fallback
// (which exists to catch a bare "Truck" or "Pickup" entry, since most
// workers will type it that plainly, and would otherwise swallow every
// other "*truck" entry too — that's exactly how a semi ended up on the
// pickup checklist before this rule existed). Same reasoning for the
// three towed-trailer templates: WALKING_FLOOR_TRAILER and DUMP_TRAILER
// are checked before the generic EQUIPMENT_TRAILER "\btrailer\b" fallback,
// which itself sits ahead of PICKUP_TRUCK/WHEEL_LOADER so an unqualified
// "trailer" never falls all the way to GENERIC — GENERIC assumes an
// engine and fluids, which no towed trailer has. First match wins.
const MATCH_RULES = [
  ["SKID_STEER", /skid.?steer|bobcat|compact track loader|\bctl\b|multi.?terrain loader/i],
  ["BACKHOE", /backhoe/i],
  ["COMPACTOR", /compactor|\broller\b|packer|padfoot|vibratory/i],
  ["DOZER", /dozer|bulldozer|crawler tractor|\btrack tractor\b/i],
  ["GRADER", /grader/i],
  ["EXCAVATOR", /excavat|trackhoe|track.?hoe|\bhoe\b/i],
  ["TRENCHER", /trencher/i],
  ["CRANE", /\bcrane\b|boom truck|picker truck/i],
  ["AERIAL_LIFT", /boom lift|man.?lift|scissor lift|aerial (platform|lift)|cherry picker/i],
  ["WALKING_FLOOR_TRAILER", /walking floor|live floor|keith\s*(trailer|walking)?|moving floor/i],
  ["DUMP_TRAILER", /dump trailer|dump.?box trailer|pintle dump|gooseneck dump|belly dump/i],
  ["DUMP_TRUCK", /dump truck|haul truck|articulated truck|rock truck|off.?road truck/i],
  ["WATER_TRUCK", /water truck|water tank/i],
  ["SEMI_TRUCK", /\bsemi\b|tractor.?trailer|18.?wheeler|highway tractor|road tractor|fifth wheel|day cab|sleeper cab|kenworth|peterbilt|freightliner|western star|\bmack\b|volvo vnl/i],
  ["SERVICE_TRUCK", /service truck|mechanic truck|deck truck/i],
  ["EQUIPMENT_TRAILER", /flatdeck|lowbo?y|lowbed|gooseneck trailer|utility trailer|equipment trailer|\btrailer\b/i],
  ["PICKUP_TRUCK", /pickup|crew cab|\btruck\b|f.?150|f.?250|f.?350|silverado|sierra|ram\s?(1500|2500|3500)|1.?ton|3\/4.?ton|half.?ton/i],
  ["WHEEL_LOADER", /loader/i],
];

// typeText/makeText/modelText are the free-text fields entered for the
// equipment (see AdminPanel's "add equipment" form) — matched by keyword
// against the combined string, most-specific pattern first.
export function matchEquipmentTemplate(typeText, makeText, modelText) {
  const haystack = [typeText, makeText, modelText].filter(Boolean).join(" ");
  for (const [key, pattern] of MATCH_RULES) {
    if (pattern.test(haystack)) return key;
  }
  return "GENERIC";
}

export function getEquipmentTemplate(typeText, makeText, modelText) {
  const key = matchEquipmentTemplate(typeText, makeText, modelText);
  return EQUIPMENT_TEMPLATES[key];
}

// Towed equipment has no engine and no odometer/hour meter of its own, so
// the pre/post-trip reading step doesn't apply to it.
const TRAILER_KEYS = new Set(["DUMP_TRAILER", "WALKING_FLOOR_TRAILER", "EQUIPMENT_TRAILER"]);

export function isTrailerTemplate(typeText, makeText, modelText) {
  return TRAILER_KEYS.has(matchEquipmentTemplate(typeText, makeText, modelText));
}

// Vehicles that realistically pull a trailer on this kind of jobsite —
// offered the "attach a trailer" option on their own pre-trip so the two
// stay linked for the trip (used by the weekly usage report to credit a
// trailer's distance to whatever towed it, since the trailer has none of
// its own to report).
const TOW_CAPABLE_KEYS = new Set(["PICKUP_TRUCK", "SERVICE_TRUCK", "SEMI_TRUCK", "DUMP_TRUCK", "WATER_TRUCK"]);

export function isTowCapableTemplate(typeText, makeText, modelText) {
  return TOW_CAPABLE_KEYS.has(matchEquipmentTemplate(typeText, makeText, modelText));
}
