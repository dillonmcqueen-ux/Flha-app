// FORA marketing site — interactive FLHA demo content.
// Static, hand-authored scenarios (no live API call — see website/demo.js).
const FLHA_DEMO_SCENARIOS = [
  {
    id: "trenching",
    chipLabel: "Trenching near utilities",
    chipIcon: "🚧",
    taskDescription: "Digging a 6ft trench for a water line with a mini excavator. Marked gas line runs along the north edge of the dig.",
    taskSummary: "Excavating a 6ft trench for a water line with a mini excavator, working adjacent to a marked underground gas line.",
    hazards: [
      { hazard: "Contact with underground gas line during excavation", risk: "Extreme", control: "Hand-expose (pothole) within 1m of the marked gas line before machine digging; confirm exact depth and alignment before excavator resumes." },
      { hazard: "Trench wall collapse / cave-in", risk: "High", control: "Bench or slope walls per soil classification for any trench over 4ft, or use a trench box; no worker enters an unprotected trench." },
      { hazard: "Struck-by excavator swing radius", risk: "High", control: "Establish and mark a swing radius exclusion zone; no ground crew inside it while the machine is operating." },
      { hazard: "Falls into open trench", risk: "Medium", control: "Barricade or flag the trench edge; place spoil pile at least 2ft back from the edge." },
      { hazard: "Struck-by falling spoil or backfill material", risk: "Medium", control: "Keep spoil piles set back from the trench edge and workers clear of the drop zone during backfill." },
      { hazard: "Underground utility strike (other than gas — power, telecom)", risk: "High", control: "Confirm a current utility locate covers the full dig footprint before any excavation begins." },
      { hazard: "Excavator operator visibility of ground crew", risk: "Medium", control: "Maintain radio or hand-signal contact between operator and ground crew at all times; no blind-spot work." },
      { hazard: "Noise exposure from excavator engine", risk: "Low", control: "Hearing protection for anyone working within close range of the running machine." },
      { hazard: "Dust/silica exposure from disturbed soil", risk: "Low", control: "Dust mask available for dry, dusty conditions; water down the area if dust becomes visible." },
      { hazard: "Pinch points during trench box or shoring placement", risk: "Medium", control: "Keep hands clear of box edges during placement; use tag lines to guide, not hands." },
      { hazard: "Ground disturbance affecting nearby structures or pavement", risk: "Low", control: "Visually monitor adjacent surfaces for cracking or settling as the trench opens." },
      { hazard: "Worker fitness for duty", risk: "Low", control: "Confirm crew is fit for duty before starting — rested, unimpaired, no undisclosed medical concerns." },
      { hazard: "Awareness of muster point and emergency response", risk: "Low", control: "Confirm site muster point and that 911/emergency services access to the site is unobstructed before work begins." }
    ],
    ppeRequired: ["Hard hat", "Safety glasses", "High-visibility vest", "Steel-toe boots", "Hearing protection (near running equipment)"],
    additionalNotes: null
  },
  {
    id: "scaffolding",
    chipLabel: "Working at height on scaffolding",
    chipIcon: "🪜",
    taskDescription: "Installing exterior siding from a 3-level tube-and-clamp scaffold, roughly 24ft up, on the side of a commercial building.",
    taskSummary: "Installing exterior siding from a 3-level tube-and-clamp scaffold at approximately 24ft, on a commercial building exterior.",
    hazards: [
      { hazard: "Fall from scaffold platform", risk: "Extreme", control: "Guardrails on all open sides of every platform level; 100% tie-off with a fall-arrest harness if guardrails are incomplete at any point." },
      { hazard: "Scaffold not tagged/inspected before use", risk: "High", control: "Confirm a current green inspection tag is posted before anyone climbs; competent person re-inspects after any wind event or modification." },
      { hazard: "Scaffold not fully planked or platform gaps", risk: "High", control: "Full planking with no gaps greater than 1 inch across every working level before use." },
      { hazard: "Overturning of scaffold due to inadequate footing or bracing", risk: "High", control: "Confirm base plates/mud sills on stable, level ground and all required bracing and ties to the structure are installed per the manufacturer's configuration." },
      { hazard: "Falling tools or material striking someone below", risk: "Medium", control: "Toe boards on all platforms, tool lanyards, and a barricaded exclusion zone at ground level beneath the work." },
      { hazard: "Access ladder to scaffold platform improperly secured", risk: "Medium", control: "Ladder access secured and extending at least 3ft above the landing platform, or use a built-in scaffold stair/ladder system." },
      { hazard: "Weather — wind affecting scaffold stability or worker balance", risk: "Medium", control: "Stop work at height if sustained wind exceeds the scaffold manufacturer's rated limit or conditions feel unsafe." },
      { hazard: "Overloading scaffold platform with material", risk: "Medium", control: "Stage siding material in small batches per the scaffold's rated load capacity, not stacked in bulk on the platform." },
      { hazard: "Power line proximity to scaffold or material handling", risk: "High", control: "Maintain minimum regulated clearance from any overhead power line; do not erect or work scaffold within that clearance without the utility de-energizing or shielding the line." },
      { hazard: "Cuts or lacerations from siding panel edges and cutting tools", risk: "Low", control: "Cut-resistant gloves when handling raw panel edges; guards in place on all cutting tools." },
      { hazard: "Fatigue from repetitive overhead work", risk: "Low", control: "Rotate tasks and take regular breaks during extended overhead installation." },
      { hazard: "Worker fitness for duty", risk: "Low", control: "Confirm no fatigue, illness, medication, or impairment before working at height." },
      { hazard: "Awareness of muster point and emergency response", risk: "Low", control: "Confirm muster point and that emergency access to the building exterior is clear before starting." }
    ],
    ppeRequired: ["Hard hat", "Fall-arrest harness and lanyard", "Non-slip footwear", "Safety glasses", "Cut-resistant gloves"],
    additionalNotes: "Overhead power line hazard was included because the task explicitly describes work on a building exterior at height — confirm actual line presence and clearance on site before relying on this control."
  },
  {
    id: "forklift",
    chipLabel: "Forklift at a loading dock",
    chipIcon: "🏭",
    taskDescription: "Loading pallets of boxed inventory onto delivery trucks at a warehouse dock using a sit-down counterbalance forklift, with pedestrian foot traffic nearby.",
    taskSummary: "Loading pallets onto delivery trucks at a warehouse dock with a sit-down counterbalance forklift, in an area with pedestrian foot traffic.",
    hazards: [
      { hazard: "Forklift/pedestrian collision in shared dock area", risk: "High", control: "Marked pedestrian walkways separate from forklift travel paths; forklift sounds horn at blind corners and dock entry/exit points." },
      { hazard: "Trailer not secured or chocked during loading", risk: "High", control: "Confirm trailer wheels are chocked and the trailer is either docked with a locked restraint or the landing gear is rated and set before driving onto it." },
      { hazard: "Dock plate/leveler failure or gap between dock and trailer", risk: "High", control: "Confirm dock plate is rated for the load and properly seated, with no gap, before crossing with the forklift." },
      { hazard: "Load instability or tip-over from improper stacking", risk: "Medium", control: "Stack pallets within the load's rated stability limits and forklift capacity; do not exceed mast height with an unstable load." },
      { hazard: "Operator not certified or refresher lapsed", risk: "Medium", control: "Confirm the operator holds a current forklift certification before assigning the task." },
      { hazard: "Falling from an elevated dock edge", risk: "Medium", control: "Dock edge guarding or a physical barrier where pedestrian traffic could approach the open dock edge." },
      { hazard: "Struck-by during backing or reversing", risk: "Medium", control: "Operator does a visual/mirror check and sounds a reverse alarm before backing; ground crew stays out of the path." },
      { hazard: "Exhaust exposure in an enclosed dock area", risk: "Low", control: "Ensure adequate ventilation in the dock area or use a propane/electric unit suited for enclosed spaces." },
      { hazard: "Pinch points at pallet or load contact points", risk: "Low", control: "Keep hands clear of pallet and load edges during placement; guide with tools or tag lines, not hands." },
      { hazard: "Musculoskeletal strain from manual box handling on/off the forklift", risk: "Low", control: "Use proper lifting technique for any manual handling; team-lift boxes over a manageable single-person weight." },
      { hazard: "Worker fitness for duty", risk: "Low", control: "Confirm operator and dock crew are fit for duty — rested, unimpaired, no undisclosed medical concerns." },
      { hazard: "Awareness of muster point and emergency response", risk: "Low", control: "Confirm muster point and that emergency access to the dock area is unobstructed before starting." }
    ],
    ppeRequired: ["Hard hat (if overhead racking present)", "High-visibility vest", "Steel-toe boots", "Safety glasses"],
    additionalNotes: null
  },
  {
    id: "confined-space",
    chipLabel: "Confined space tank entry",
    chipIcon: "🛢️",
    taskDescription: "Entering a drained storage tank through a top manway to clean residue with a scraper and shop vac, one entrant plus an attendant outside.",
    taskSummary: "Confined space entry into a drained storage tank via a top manway to manually clean residue, with one entrant and one attendant.",
    hazards: [
      { hazard: "Atmospheric hazard — oxygen deficiency, toxic vapors, or flammable atmosphere inside the tank", risk: "Extreme", control: "Test the atmosphere (O2, LEL, toxics) before entry and continuously monitor throughout; do not enter if readings are outside safe limits." },
      { hazard: "Entry without a confined space permit and attendant in place", risk: "Extreme", control: "Complete a confined space entry permit and confirm a trained attendant is stationed at the entry point for the full duration of entry." },
      { hazard: "Engulfment or entrapment by residual product/sludge", risk: "High", control: "Confirm the tank is fully drained and residue depth is inspected before entry; do not enter if pooled liquid or unstable sludge remains." },
      { hazard: "Inability to rescue entrant quickly if incident occurs", risk: "High", control: "Entrant wears a retrieval harness connected to a tripod/winch at the manway, and a written rescue plan is in place before entry — attendant does not enter to rescue." },
      { hazard: "Loss of communication between entrant and attendant", risk: "High", control: "Maintain continuous visual, voice, or radio contact between entrant and attendant throughout entry." },
      { hazard: "Static discharge or ignition source igniting residual vapors", risk: "High", control: "Use non-sparking tools and bond/ground the tank and equipment if any flammable residue is possible." },
      { hazard: "Slips on residue-coated interior surfaces", risk: "Medium", control: "Use slip-resistant footwear and proceed carefully on cleaned vs. uncleaned sections of the tank floor." },
      { hazard: "Limited egress through a single top manway", risk: "Medium", control: "Confirm the manway opening and any internal obstructions still allow the entrant to exit quickly and with rescue equipment attached." },
      { hazard: "Poor lighting inside the tank", risk: "Medium", control: "Use intrinsically safe lighting rated for the atmosphere present." },
      { hazard: "Skin or eye contact with residue during scraping", risk: "Low", control: "Chemical-resistant gloves and splash-rated eye protection while scraping and vacuuming residue." },
      { hazard: "Awareness of muster point and emergency response, including 911/emergency service availability", risk: "Low", control: "Confirm site muster point and that emergency responders can reach and access the tank location before entry begins." },
      { hazard: "Worker fitness for duty", risk: "Low", control: "Confirm entrant and attendant are fit for duty — rested, unimpaired, no undisclosed medical concerns, and not claustrophobic-restricted from confined entry." }
    ],
    ppeRequired: ["Confined space retrieval harness", "Atmospheric gas monitor", "Chemical-resistant gloves", "Eye protection", "Intrinsically safe lighting", "Respiratory protection (if indicated by air monitoring)"],
    additionalNotes: null
  },
  {
    id: "hot-work",
    chipLabel: "Hot work / welding in a shop",
    chipIcon: "🔥",
    taskDescription: "Welding a repair on a steel equipment frame at a bench in the maintenance shop, with other trades working nearby and some combustible material stored along the wall.",
    taskSummary: "Welding a repair on a steel equipment frame at a shop bench, with other trades nearby and combustible material stored along the shop wall.",
    hazards: [
      { hazard: "Fire ignition from welding sparks contacting nearby combustible material", risk: "High", control: "Clear or shield combustible material within the welding sparks' travel radius before starting; keep a charged fire extinguisher within reach." },
      { hazard: "Arc flash or burns to nearby trades from unshielded welding", risk: "High", control: "Set up welding screens/curtains around the work area so nearby trades aren't exposed to arc flash." },
      { hazard: "Welding fume exposure", risk: "Medium", control: "Use local exhaust ventilation or a fume extractor at the work point; ensure general shop ventilation is adequate." },
      { hazard: "Eye and skin burns to the welder from arc/UV exposure", risk: "Medium", control: "Welding helmet with correct shade lens, flame-resistant clothing, and welding gloves worn for the full task." },
      { hazard: "Electric shock from welding equipment", risk: "Medium", control: "Inspect welding leads and equipment for damage before use; ensure proper grounding of the workpiece." },
      { hazard: "No hot work permit or fire watch for the task", risk: "Medium", control: "Complete a hot work permit if required by site procedure and assign a fire watch during and for a period after welding stops." },
      { hazard: "Compressed gas cylinder hazards (if oxy-fuel used)", risk: "Medium", control: "Secure cylinders upright, chained, with valve caps on when not in use; keep oxygen and fuel gas cylinders separated per requirements." },
      { hazard: "Struck-by or trip hazard from welding leads/hoses across shop floor", risk: "Low", control: "Route leads and hoses away from other trades' walkways or cover/flag them where they cross a path." },
      { hazard: "Noise from grinding or fit-up work before welding", risk: "Low", control: "Hearing protection during any grinding or hammering steps of the repair." },
      { hazard: "Musculoskeletal strain from positioning the equipment frame", risk: "Low", control: "Use shop lifting equipment or a team lift to position the frame rather than manual handling alone." },
      { hazard: "Worker fitness for duty", risk: "Low", control: "Confirm welder and nearby trades are fit for duty — rested, unimpaired, no undisclosed medical concerns." },
      { hazard: "Awareness of muster point and emergency response", risk: "Low", control: "Confirm shop muster point and that emergency access/exits remain clear during the task." }
    ],
    ppeRequired: ["Welding helmet (correct shade)", "Flame-resistant clothing", "Welding gloves", "Safety glasses (under helmet)", "Hearing protection (during grinding/fit-up)"],
    additionalNotes: null
  }
];
