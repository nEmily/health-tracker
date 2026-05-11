// fitness.js — Interactive workout checklist with exercise database

const Fitness = {
  // Exercise database — form cues, muscles, purpose
  exercises: {
    'goblet squats': {
      muscles: 'Quads, glutes, core',
      why: 'The biggest calorie-burning muscles in your body. Squats under load signal your legs to hold onto muscle during a cut — and a strong core engagement means bonus core work every rep.',
      form: 'Hold kettlebell at chest, elbows tucked. Feet shoulder-width, toes slightly out. Sit back and down — hips below knees. Chest stays up, weight in heels. Drive up through heels.',
      mistakes: 'Knees caving inward (push them out over toes). Leaning forward (keep chest proud). Not going deep enough (hip crease below knee).',
    },
    'push-ups': {
      muscles: 'Chest, shoulders, triceps, core',
      why: 'Full-body pressing that doubles as a plank. Every push-up is core training in disguise — your core fights to keep your hips from sagging.',
      form: 'Hands just outside shoulder-width. Body in a straight line from head to heels. Lower until chest nearly touches floor. Push back up, fully extending arms. Squeeze glutes to keep hips level.',
      mistakes: 'Sagging hips (squeeze glutes). Flaring elbows to 90° (keep them at ~45°). Half reps (full range of motion matters).',
    },
    'dumbbell rows': {
      muscles: 'Back (lats), biceps, rear delts, core',
      why: 'Balances all the pushing work. A strong back improves posture and physique. Also works core anti-rotation.',
      form: 'One hand and knee on bench (or bent over). Pull dumbbell to hip, squeezing shoulder blade back. Lower with control — don\'t just drop it.',
      mistakes: 'Twisting torso to heave weight up (keep hips square). Using momentum (slow and controlled). Shrugging shoulder up (pull to hip, not ear).',
    },
    'lunges': {
      muscles: 'Quads, glutes, hamstrings, balance',
      why: 'Single-leg work fixes imbalances and fires up stabilizer muscles. Burns more calories per rep than bilateral exercises because your core works overtime to keep you balanced.',
      form: 'Step forward, lower until both knees at 90°. Front knee tracks over ankle — never past toes. Back knee hovers just above floor. Push back to standing through front heel.',
      mistakes: 'Front knee shooting past toes (shorter step). Wobbling side to side (engage core, go slower). Leaning forward (stay upright).',
    },
    'dumbbell overhead press': {
      muscles: 'Shoulders (delts), triceps, core',
      why: 'Pressing overhead requires serious core bracing — your core works hard to stabilize your spine under load. Defined shoulders improve your overall physique.',
      form: 'Start with dumbbells at shoulder height, palms forward. Press straight up, fully extending arms. Bring them slightly together at top. Lower with control to shoulders.',
      mistakes: 'Arching lower back (brace core tight, slight lean back is OK). Not fully extending (lockout at top). Using legs to push (that\'s a push press — different exercise).',
    },
    'romanian deadlifts': {
      muscles: 'Hamstrings, glutes, lower back',
      why: 'The hip hinge is the most important movement pattern for posture and glute development. Strong posterior chain = everything looks better from behind. Also protects your lower back.',
      form: 'Hold dumbbells in front of thighs. Slight knee bend (soft, not locked). Push hips BACK like closing a car door with your butt. Lower weights along your legs until you feel a deep hamstring stretch. Drive hips forward to stand.',
      mistakes: 'Rounding your back (keep chest up, shoulders back). Bending knees too much (this isn\'t a squat — hips go BACK). Going too heavy too soon (feel the stretch first, add weight later).',
    },
    'resistance band pull-aparts': {
      muscles: 'Rear delts, upper back, rotator cuff',
      why: 'Counteracts phone/desk posture. Pulls your shoulders back, which makes your chest and abs more visible. Also keeps shoulders healthy for pressing.',
      form: 'Hold band at shoulder height, arms straight out. Pull band apart by squeezing shoulder blades together. Pause at full stretch. Return slowly.',
      mistakes: 'Using arms instead of back (think "squeeze shoulder blades"). Shrugging up (keep shoulders down). Going too fast (slow squeeze, slow return).',
    },
    'bodyweight squats': {
      muscles: 'Quads, glutes, core',
      why: 'Higher rep bodyweight work is more metabolic — keeps heart rate up while training legs. Good for building muscular endurance on a deficit.',
      form: 'Same as goblet squat but arms extended forward for balance. Full depth — hips below knees. Drive up through heels.',
      mistakes: 'Same as goblet squats. Without weight, people tend to go too fast — control the descent (2 seconds down, 1 second up).',
    },
    'kettlebell swings': {
      muscles: 'Glutes, hamstrings, core, shoulders, grip',
      why: 'The best bang-for-your-buck exercise. Explosive hip hinge burns calories like cardio while building posterior chain like strength training. 15 swings ≈ a sprint.',
      form: 'Hinge at hips, grip KB with both hands. Hike it back between legs. Snap hips forward explosively — the swing comes from your HIPS, not arms. At top, squeeze glutes hard, arms float to shoulder height.',
      mistakes: 'Squatting instead of hinging (push hips BACK). Using arms to lift (arms are just ropes — power comes from hip snap). Hyperextending back at top (stand tall, don\'t lean back).',
    },
    'dumbbell bench press': {
      muscles: 'Chest, shoulders, triceps',
      why: 'The king of upper body pushing. Dumbbells let each arm work independently, fixing imbalances. A defined chest adds shape to your upper body.',
      form: 'Lie on bench, feet flat on floor. Dumbbells at chest level, palms forward. Press up, bringing dumbbells slightly together at top. Lower with control until elbows are at 90° or slightly below.',
      mistakes: 'Bouncing at bottom (pause briefly). Feet coming off floor (keep planted for stability). Flaring elbows to 90° (keep at ~45°).',
    },
    'pull-up negatives': {
      muscles: 'Back (lats), biceps, forearms, core',
      why: 'Building toward full pull-ups — the ultimate back exercise. Negatives (lowering slowly) build strength through the hardest part. Lats are the widest muscle on your body — they create the V-taper silhouette.',
      form: 'Jump or step up to the top position (chin above bar). Lower yourself as SLOWLY as possible — aim for 5+ seconds. At the bottom, let go, reset, repeat.',
      mistakes: 'Dropping too fast (the slow descent IS the exercise). Kipping or swinging (dead hang, strict control). Gripping too narrow (shoulder width or slightly wider).',
    },
    'step-up lunges': {
      muscles: 'Quads, glutes, balance',
      why: 'Higher step = more glute activation. Single-leg strength that directly translates to everything — stairs, hiking, running.',
      form: 'Use a sturdy step or bench. Step up with one foot, drive through that heel to stand tall. Step back down with control. All 10 on one side, then switch.',
      mistakes: 'Pushing off the back foot (all the work should come from the front leg). Too high a step to start (12-16 inches is enough). Leaning forward (stay tall).',
    },
    'plank': {
      muscles: 'Entire core — rectus abdominis, transverse abdominis, obliques',
      why: 'The foundation of core training. Teaches your core to STABILIZE under load. Every other exercise is harder without a strong plank.',
      form: 'Forearms on ground, body in a straight line. Squeeze glutes, brace abs like someone\'s about to poke your stomach. Breathe normally. Don\'t let hips sag or pike up.',
      mistakes: 'Hips sagging (squeeze glutes harder). Hips piking up (you\'re making it easier — lower them). Holding breath (breathe steadily).',
    },
    'dead bugs': {
      muscles: 'Deep core (transverse abdominis), hip flexors',
      why: 'The best core exercise most people skip. Trains anti-extension — your core learns to keep your lower back flat while limbs move. This builds deep stability that carries over to every other exercise.',
      form: 'Lie on back. Arms straight up, knees at 90°. Press lower back into floor (NO gap). Extend opposite arm and leg slowly. Return. Switch sides. Lower back stays glued to floor the ENTIRE time.',
      mistakes: 'Lower back arching off floor (this is the whole point — if it arches, you\'ve gone too far). Going too fast (slow = harder = better). Holding breath (exhale as you extend).',
    },
    'bicycle crunches': {
      muscles: 'Obliques, rectus abdominis',
      why: 'One of the highest muscle activation exercises for obliques. The rotation component builds a strong, defined midsection.',
      form: 'Lie on back, hands behind head. Lift shoulders off floor. Bring knee to opposite elbow while extending other leg. Alternate in a pedaling motion. Don\'t pull on your neck.',
      mistakes: 'Pulling neck forward (hands are just resting behind head). Going too fast (slow and controlled — hold each twist for a beat). Not lifting shoulders (crunch UP, don\'t just move elbows).',
    },
    'leg raises': {
      muscles: 'Lower rectus abdominis, hip flexors',
      why: 'Directly targets the lower belly area. EMG studies show high lower ab activation — but ONLY if you maintain posterior pelvic tilt. Without it, your hip flexors do all the work and your abs get nothing.',
      form: 'Lie flat, hands under hips or gripping something behind you. Press your lower back into the floor (posterior pelvic tilt). Raise legs to 90°. Lower SLOWLY — stop BEFORE your lower back starts to arch off the floor.',
      mistakes: 'Lower back arching off the floor (the #1 mistake — reduce range if needed). Dropping legs too fast (slow descent is where the work happens). Legs bending (keep as straight as possible).',
    },
    'plank shoulder taps': {
      muscles: 'Core (anti-rotation), shoulders',
      why: 'Levels up the basic plank by adding anti-rotation — your core fights to keep your hips still while you shift weight. This builds deep stability and total-body control.',
      form: 'Start in push-up position. Tap left shoulder with right hand, then right shoulder with left hand. The goal: your hips should NOT rock side to side. Widen feet for more stability.',
      mistakes: 'Hips rocking side to side (slow down, widen stance). Rushing (each tap should be deliberate). Sagging hips (same as plank — squeeze glutes).',
    },
    'bird dogs': {
      muscles: 'Core, lower back, glutes',
      why: 'Trains the same anti-extension as dead bugs but from all fours — different angle means different muscle fibers. Also bulletproofs your lower back, which lets you go harder on everything else.',
      form: 'On hands and knees. Extend opposite arm and leg until parallel to floor. Hold 2 seconds. Return with control. Switch sides. Keep hips level — imagine balancing a cup of water on your lower back.',
      mistakes: 'Rotating hips (keep them square to the floor). Rushing (hold at the top). Arching back (neutral spine the entire time).',
    },
    'ab wheel rollouts': {
      muscles: 'Rectus abdominis, obliques, lats, shoulders',
      why: 'One of the highest EMG activation exercises for abs — your entire core fights to prevent your spine from extending as you roll out. Builds the thick ab muscle that becomes visible as fat comes off.',
      form: 'Start on knees, hands on wheel. Roll forward slowly, extending arms. Go as far as you can without your hips sagging or lower back arching. Pull back by squeezing abs — imagine curling your pelvis toward your ribcage.',
      mistakes: 'Hips sagging (means you went too far — shorten the range). Lower back arching (squeeze abs harder, reduce range). Using arms to pull back (the abs do the work, arms are just holding on).',
    },
    'reverse crunches': {
      muscles: 'Lower rectus abdominis, hip flexors',
      why: 'Research shows reverse crunches preferentially activate the lower portion of the rectus abdominis more than standard crunches. The movement — curling your hips toward your ribcage — directly targets the area below your belly button.',
      form: 'Lie on back, knees bent at 90°. Curl your hips off the floor, bringing knees toward your chest. The motion is small — your lower back lifts off the ground. Lower slowly. Don\'t use momentum.',
      mistakes: 'Swinging legs (the motion is a hip curl, not a knee pull). Using momentum (slow and controlled). Not lifting hips off the floor (that\'s just knee tucks — your hips must curl up).',
    },
    'v-sits': {
      muscles: 'Rectus abdominis, hip flexors',
      why: 'High activation exercise — EMG studies show ~80% max voluntary contraction. Challenges both upper and lower abs simultaneously as you balance on your sit bones.',
      form: 'Sit on floor, lean back slightly. Lift legs and torso simultaneously to form a V shape, balancing on sit bones. Arms reach toward feet. Hold briefly at top. Lower with control.',
      mistakes: 'Rounding upper back excessively (keep chest open). Using momentum to swing up (slow and controlled). Not holding at the top (pause for a beat).',
    },
    'stomach vacuums': {
      muscles: 'Transverse abdominis (deep core)',
      why: 'Targets the TVA — your body\'s natural corset muscle. Research showed 45% increase in TVA thickness in 5 weeks. A stronger TVA holds your belly tighter at rest, creating a visibly flatter stomach even before all fat is gone.',
      form: 'Exhale ALL air from your lungs. Pull your belly button toward your spine as hard as you can. Hold 10-20 seconds while breathing shallowly through your chest. Release. That\'s one rep.',
      mistakes: 'Holding your breath entirely (breathe shallowly through chest). Not exhaling fully first (the vacuum works best when lungs are empty). Sucking in your chest instead of your belly (focus on pulling the navel inward).',
    },
    'glute bridges': {
      muscles: 'Glutes, hamstrings, core',
      why: 'Strong glutes improve posture, reduce lower back stress, and create the posterior shape that makes your waist look smaller by contrast. Also trains hip extension — the movement pattern behind walking, running, and climbing.',
      form: 'Lie on back, feet flat on floor hip-width apart, knees bent. Drive hips up by squeezing glutes hard. Hold at the top for 2 seconds. Lower with control. Your body should form a straight line from shoulders to knees at the top.',
      mistakes: 'Pushing through toes instead of heels (heels drive the movement). Not squeezing at top (hold and squeeze glutes). Arching lower back at top (stop when hips are level, don\'t hyperextend).',
    },
    'dumbbell bicep curls': {
      muscles: 'Biceps, forearms',
      why: 'Isolation work for arm size and strength. Balanced biceps complement pushing movements and improve pulling exercises like rows.',
      form: 'Stand with feet hip-width, dumbbells at sides, palms forward. Curl up by bending elbows — keep upper arms still. Squeeze at the top, lower with control (3 seconds down).',
      mistakes: 'Swinging the body for momentum (stand still, use less weight). Letting elbows drift forward (pin them to your sides). Rushing the lowering phase (slow eccentric builds more muscle).',
    },
    'calf raises': {
      muscles: 'Calves (gastrocnemius, soleus)',
      why: 'Calves are used in every step you take. Strong calves improve ankle stability, reduce injury risk, and support running and hiking.',
      form: 'Stand on edge of a step or flat ground. Rise up onto toes, squeezing calves at the top. Hold for 1 second. Lower slowly until heels are below the step (full stretch).',
      mistakes: 'Bouncing at the bottom (pause and stretch). Not going high enough (full contraction at top). Using momentum (slow and controlled).',
    },
    'cable side bend': {
      muscles: 'Obliques (internal + external), QL',
      why: 'Loaded lateral flexion is the most direct oblique builder. The cable keeps tension on the side throughout the entire range — better than dumbbell side bends, which lose load at the top. Building obliques sharpens the waist taper.',
      form: 'Stand sideways to a low cable, handle in the OUTER hand (farthest from the stack). Feet shoulder-width, hips square, free hand on hip. Bend laterally AWAY from the stack like you\'re trying to touch your knee with your fingers. Control back to vertical.',
      mistakes: 'Rotating the torso (this is pure side-bend — keep hips and shoulders facing forward). Using the arm to pull (the arm just holds the handle, the obliques bend). Bending forward (lateral only, no flexion). Going too heavy and losing range.',
    },
    'pallof press': {
      muscles: 'Obliques, deep core (anti-rotation)',
      why: 'The single best anti-rotation exercise. Your obliques fight to keep your torso square while the cable tries to pull you sideways. Trains the core to resist force — which is what it actually does in life.',
      form: 'Cable at sternum height, stand sideways to the stack. Hold the handle at chest with both hands, step OUT for tension. Press the handle straight out from the chest, hold 1-2 seconds resisting the pull, then return. The cable wants to rotate you — don\'t let it.',
      mistakes: 'Letting the torso rotate toward the stack (the whole point is preventing this). Standing too close to the stack (no tension = no work). Using shoulders to press (it\'s an isometric core hold, not a chest press).',
    },
    'hip thrust': {
      muscles: 'Glutes (max), hamstrings, core',
      why: 'The single highest-EMG glute exercise. Builds the shape and strength of the glutes faster than squats or deadlifts because hip extension is loaded directly at end range. The exercise behind serious glute development.',
      form: 'Upper back on a bench (across the shoulder blades, not the neck). Barbell across the hips with a pad — feet planted shoulder-width, shins vertical at the top. Drive through heels, locking out hips at the top. Squeeze glutes HARD. Ribs down, chin tucked — neutral spine throughout.',
      mistakes: 'Hyperextending lower back at the top (ribs down — glutes do the lockout, not the spine). Feet too far forward (turns it into a hamstring exercise). Not locking out (full hip extension is the whole point). Skipping the pad and bruising your hips.',
    },
    'goblet squat': {
      muscles: 'Quads, glutes, core',
      why: 'The biggest calorie-burning muscles in your body. The front-loaded position forces an upright torso and braces the core every rep — bonus core work built in.',
      form: 'Hold KB or DB at chest, elbows tucked. Feet shoulder-width, toes slightly out. Sit back AND down — hip crease below knee. Chest up, weight in heels. Drive up through heels.',
      mistakes: 'Knees caving in (push them out over the toes). Leaning forward (chest proud — the load is on your chest for a reason). Not going deep enough (hip crease BELOW knee, not parallel).',
    },
    'cable woodchopper': {
      muscles: 'Obliques (rotational), core, lats',
      why: 'Rotational power and oblique strength under load. Different stimulus from the Pallof press — that one resists rotation, this one PRODUCES rotation against resistance. Both build a complete oblique.',
      form: 'Cable high (high-to-low chop) or low (low-to-high chop), stand perpendicular to the stack. Hold the handle with both hands, arms straight. Rotate diagonally across the body, leading with the torso — arms are along for the ride. Control back to start.',
      mistakes: 'Pulling with the arms (it\'s a torso rotation, arms stay relatively straight). Bending the elbows mid-rep (kills oblique load). Going too heavy (sloppy rotation = lower back stress). Letting the hips rotate fully (only the torso rotates — hips stay relatively square).',
    },
    'hip abduction machine': {
      muscles: 'Glute medius, glute minimus (outer hip)',
      why: 'Direct isolation of the glute medius — the side glute that creates hip shape and stabilizes the pelvis during squats and walking. Strong abductors prevent knee cave and improve every lower body lift.',
      form: 'Seated abduction machine, pads against the OUTSIDE of the knees. Push knees OUT against the pads. Squeeze the outer glute at the end range, hold 1 second, control back in. Lean slightly forward to bias glute medius.',
      mistakes: 'Using momentum (slow and controlled both directions). Not pausing at the end range (the squeeze is where the work happens). Going too heavy and rocking the body (lighter weight, cleaner reps).',
    },
    'cable crunch': {
      muscles: 'Rectus abdominis (upper + lower fibers)',
      why: 'The most loadable ab exercise. Lets you progressively overload the abs with weight — the same principle that builds every other muscle. Higher EMG than bodyweight crunches because of the resistance throughout the range.',
      form: 'Rope on high pulley, kneel facing the cable. Hold rope at the sides of your head. Crunch DOWN by curling your spine — driving elbows toward thighs. Hips stay locked in place. This is SPINAL FLEXION, not a hip hinge.',
      mistakes: 'Hinging at the hips instead of crunching (if the hips move, the abs aren\'t working). Pulling with the arms (rope is just an anchor for the load). Not curling the spine (the lower back should round at the bottom of the rep).',
    },
    'rdl': {
      muscles: 'Hamstrings, glutes, lower back',
      why: 'The hip hinge — the most important movement pattern for posture and glute/hamstring development. Strong posterior chain holds everything together and bulletproofs the lower back.',
      form: 'Barbell or DBs in front of thighs. Slight knee bend (soft, NOT locked). Push hips BACK like closing a car door with your butt. Bar slides down the legs, stays close. Stop at deep hamstring stretch (just below the kneecap for most). Drive hips forward to stand. Neutral spine the entire time.',
      mistakes: 'Rounding the back (chest up, lats engaged — pull the bar to your legs). Squatting instead of hinging (knees barely bend — hips go BACK). Going too heavy too soon (find the stretch first, add load second). Locking knees (slight bend always).',
    },
    'hollow body hold': {
      muscles: 'Rectus abdominis, deep core (TVA), hip flexors',
      why: 'Gymnastics staple. Teaches the whole core to fire as one unit and trains anti-extension. Carries over to every other lift — you brace better, lift heavier, protect your spine.',
      form: 'Lie on back. Press lower back FLAT into the floor — completely glued, no gap. Lift shoulders and legs off the floor. Arms overhead, legs straight and low. Hold. The lower back stays flat for the entire hold — that\'s the whole exercise.',
      mistakes: 'Lower back arching off the floor (you\'ve gone too far — bring arms or legs higher to make it easier). Holding the breath (breathe shallowly through the chest). Looking up (chin tucked slightly toward chest).',
    },
    'back extension': {
      muscles: 'Spinal erectors, glutes, hamstrings',
      why: 'Direct strengthening of the spinal erectors — the muscles that protect your lower back during every other lift. Weighted back extensions also load the glutes at end range, which makes them a serious posterior chain builder.',
      form: '45-degree back extension bench. Hold a plate at the chest (or behind the head for more load). Hinge at the HIPS — lower until torso is below parallel. Extend back up by squeezing glutes and erectors. Stop when in line with the legs — do NOT hyperextend.',
      mistakes: 'Hyperextending at the top (stop when torso is in line with legs — no further). Bending at the spine instead of hinging at the hips (the movement is at the hip joint). Jerking up (smooth and controlled). Going too heavy and losing form.',
    },
    'dumbbell pullover': {
      muscles: 'Lats, serratus, pecs, long head of triceps',
      why: 'Trains the lats in deep shoulder flexion — a range most pulling exercises miss. Also stretches the rib cage and serratus. Excellent for building back width and improving overhead mobility.',
      form: 'Lie on a bench, hold a single DB overhead with both hands cupped under the top plate. Slight bend in the elbows — KEEP this bend constant. Lower the DB back behind the head until you feel a deep stretch in the lats and serratus. Pull the DB back over the chest using the lats, not the arms.',
      mistakes: 'Bending the elbows during the rep (the bend stays constant — it\'s a straight-arm-ish movement). Flaring the ribs (ribs DOWN, core braced — protects the lower back). Going too heavy and losing the lat stretch (lighter = better range).',
    },
    'lat pulldown': {
      muscles: 'Lats, biceps, rear delts, mid-back',
      why: 'The lat-builder when pull-ups aren\'t there yet (or when you want to keep building once they are). Direct loadable pulling — the move that creates back width and the V-taper.',
      form: 'Slightly wider than shoulder-width grip, lean back ~10-15 degrees. Pull the bar to the upper chest, leading with the ELBOWS (think: drive elbows to the floor). Squeeze lats hard at the bottom. Control the bar back up to full stretch — don\'t just let it snap up.',
      mistakes: 'Leaning back too far and using momentum (10-15 degrees max). Pulling to the neck (upper chest is the target — neck pulls trash the shoulders). Using biceps instead of lats (think elbows, not hands). Not getting full stretch at the top (full range = full growth).',
    },
  },

  // Get exercise list from a day plan — supports structured (exercises array) and legacy (description text)
  getExerciseList(todayPlan) {
    if (!todayPlan) return [];
    // New structured format: exercises array with name, sets, reps, formCue
    const mapEx = (ex, opts = {}) => {
      const setsReps = ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : '';
      const dbKey = Object.keys(Fitness.exercises).find(k =>
        ex.name.toLowerCase().includes(k) || k.includes(ex.name.toLowerCase())
      );
      return {
        name: ex.name,
        setsReps,
        sets: ex.sets || null,
        reps: ex.reps || null,
        extra: ex.formCue || '',
        isCore: (ex.section || '').toLowerCase() === 'core',
        isOptional: !!opts.isOptional,
        details: dbKey ? Fitness.exercises[dbKey] : null,
      };
    };
    if (todayPlan.exercises && Array.isArray(todayPlan.exercises) && todayPlan.exercises.length > 0) {
      const main = todayPlan.exercises.map(ex => mapEx(ex));
      // Append optional bonus exercises so the user can still see and check them.
      // Schema variants: optionalBonus (camel), optional_bonus (snake), bonus.
      const optionalArr = todayPlan.optionalBonus || todayPlan.optional_bonus || todayPlan.bonus || [];
      const optional = Array.isArray(optionalArr)
        ? optionalArr.map(ex => mapEx(ex, { isOptional: true }))
        : [];
      // Append core exercises if a separate `core` array exists alongside `exercises`.
      const coreArr = todayPlan.core || [];
      const core = Array.isArray(coreArr)
        ? coreArr.map(ex => mapEx({ ...ex, section: 'core' }))
        : [];
      return [...main, ...core, ...optional];
    }
    // Cardio day — single exercise
    if (todayPlan.type === 'cardio') {
      return [{ name: 'cardio', setsReps: '', sets: null, reps: null, extra: todayPlan.description || '', isCore: false, isOptional: false, details: null }];
    }
    // Legacy text-based format
    return Fitness.parseExercises(todayPlan.description);
  },

  // Parse a workout description string into individual exercises (legacy format)
  parseExercises(description) {
    if (!description) return [];
    // Split on || for section breaks (e.g., "...exercises || Core: ...")
    const sections = description.split('||').map(s => s.trim());
    const exercises = [];

    for (const section of sections) {
      const parts = section.split('|').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        // Try to parse "Exercise 3x12" or "Exercise 3x12 (notes)"
        const match = part.match(/^(?:Core:\s*)?(.+?)(?:\s+(\d+x\d+(?:s|sec)?)(?:\s+(.+))?)?$/i);
        if (match) {
          const rawName = match[1].trim();
          if (!rawName) continue;
          const setsReps = match[2] || '';
          const extra = match[3] || '';
          const isCore = part.toLowerCase().startsWith('core:');

          // Parse sets/reps numbers from setsReps string (e.g. "3x12")
          let sets = null;
          let reps = null;
          if (setsReps) {
            const srMatch = setsReps.match(/^(\d+)x(\d+)/);
            if (srMatch) {
              sets = parseInt(srMatch[1], 10);
              reps = parseInt(srMatch[2], 10);
            }
          }

          // Look up in database (case-insensitive, partial match)
          const dbKey = Object.keys(Fitness.exercises).find(k =>
            rawName.toLowerCase().includes(k) || k.includes(rawName.toLowerCase())
          );

          exercises.push({
            name: rawName,
            setsReps,
            sets,
            reps,
            extra,
            isCore,
            details: dbKey ? Fitness.exercises[dbKey] : null,
          });
        }
      }
    }
    return exercises;
  },

  // Normalize regimen schema. Synthesis emits at least 4 different shapes:
  //   { weeklySchedule: [{day, ...}] }                      (camelCase preferred)
  //   { weekly_schedule: [{day, ...}] }                     (snake_case)
  //   { weeklyStructure: [...] | {} }                       (yet another)
  //   { days: [{day | dayOfWeek, ...}] }                    (with dayOfWeek key)
  // Returns canonical [{day, type, exercises, description, ...}, ...].
  _normalizeSchedule(regimen) {
    if (!regimen) return [];
    const raw = regimen.weeklySchedule
              || regimen.weekly_schedule
              || regimen.weeklyStructure
              || regimen.days
              || [];
    if (!Array.isArray(raw)) {
      // Object-keyed (e.g. {monday: {...}}) — coerce to array
      if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([k, v]) => ({ day: k.toLowerCase(), ...(v || {}) }));
      }
      return [];
    }
    return raw.map(d => {
      const day = (d.day || d.dayOfWeek || d.day_of_week || '').toString().toLowerCase();
      return { ...d, day };
    });
  },

  // Render the interactive workout checklist (individual exercise cards)
  async render(regimen, date) {
    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const schedule = Fitness._normalizeSchedule(regimen);
    const todayPlan = schedule.find(d => d.day === dayName);
    const isRest = !todayPlan || todayPlan.type === 'rest' || todayPlan.type === 'active_rest' || todayPlan.type === 'active_recovery';
    const notes = await Fitness.getWorkoutNotes(date);
    const checked = await Fitness.getCheckedExercises(date);
    const setsData = await Fitness.getSetsData(date);
    const daysOut = await Fitness.getDaysWithoutWorkout(date);

    if (isRest) {
      return `
        <div class="card" style="text-align:center; padding:var(--space-md); margin-top:var(--space-sm);">
          <div style="font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; font-weight:600;">Rest Day</div>
          <div style="font-size:var(--text-sm); color:var(--text-secondary); margin-top:2px;">${todayPlan ? UI.escapeHtml(todayPlan.description) : 'Recover and recharge.'}</div>
        </div>
        <div class="card fitness-notes-card" id="fitness-notes-card" style="margin-top:var(--space-sm); padding:var(--space-sm) var(--space-md);">
          ${notes ? `
            <div style="font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:var(--space-xs);">Notes</div>
            <textarea class="form-input fitness-notes" id="fitness-notes" placeholder="How did it feel? Any modifications?" rows="1" style="border:none; padding:0 0 8px; background:transparent; font-size:var(--text-sm);">${UI.escapeHtml(notes)}</textarea>
            <button class="btn btn-ghost" id="fitness-save-btn" style="margin-top:var(--space-xs); font-size:var(--text-xs); opacity:0.6;">Save</button>
          ` : `
            <button class="btn btn-ghost fitness-notes-prompt" id="fitness-notes-prompt" style="width:100%; text-align:left; color:var(--text-muted); font-size:var(--text-sm); padding:0;">+ Add notes...</button>
            <textarea class="form-input fitness-notes" id="fitness-notes" placeholder="How did it feel? Any modifications?" rows="2" style="display:none; border:none; padding:0 0 8px; background:transparent; font-size:var(--text-sm);"></textarea>
            <button class="btn btn-ghost" id="fitness-save-btn" style="display:none; margin-top:var(--space-xs); font-size:var(--text-xs); opacity:0.6;">Save</button>
          `}
        </div>
      `;
    }

    const exercises = Fitness.getExerciseList(todayPlan);
    let html = '';

    // Lazy indicator — show if 3+ days without a completed workout
    if (daysOut >= 3) {
      html += `
        <div class="fitness-lazy-banner">
          ${daysOut === 7 ? '7+ days' : `${daysOut} days`} since your last workout. No more rest.
        </div>
      `;
    }

    // Day type header — context for what today's workout is
    const typeLabel = todayPlan.type === 'cardio' ? 'Cardio Day' :
                      todayPlan.type === 'strength' ? todayPlan.description || 'Strength Day' :
                      todayPlan.description || todayPlan.type;
    const mainCount = exercises.filter(e => !e.isOptional && !e.isCore).length;
    const coreCount = exercises.filter(e => e.isCore).length;
    const optionalCount = exercises.filter(e => e.isOptional).length;
    const countParts = [];
    if (mainCount) countParts.push(`${mainCount} main`);
    if (coreCount) countParts.push(`${coreCount} core`);
    if (optionalCount) countParts.push(`${optionalCount} optional`);
    const countLabel = countParts.length ? countParts.join(' · ') : `${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}`;
    html += `
      <div class="card fitness-day-header" style="text-align:center; padding:var(--space-sm) var(--space-md); margin-bottom:var(--space-sm);">
        <div style="font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; font-weight:600;">${UI.escapeHtml(typeLabel)}</div>
        <div style="font-size:var(--text-sm); color:var(--text-secondary); margin-top:2px;">${countLabel}</div>
      </div>
    `;

    // Each exercise as its own card
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const isDone = checked.has(ex.name);
      const hasDetails = !!ex.details;
      const hasStructuredSets = ex.sets && ex.reps;

      // Section divider for Core
      if (ex.isCore && (i === 0 || !exercises[i - 1].isCore)) {
        html += `<div style="font-size:var(--text-xs); font-weight:600; color:var(--text-muted); text-transform:uppercase; margin:var(--space-sm) 0 var(--space-xs);">Core</div>`;
      }
      // Section divider for Optional bonus exercises
      if (ex.isOptional && (i === 0 || !exercises[i - 1].isOptional)) {
        html += `<div style="font-size:var(--text-xs); font-weight:600; color:var(--text-muted); text-transform:uppercase; margin:var(--space-md) 0 var(--space-xs); display:flex; align-items:center; gap:var(--space-xs);">
          <span>Optional bonus</span>
          <span style="font-weight:400; text-transform:none; opacity:0.7;">— add if you have energy</span>
        </div>`;
      }

      // Build set rows for structured exercises
      let setRowsHtml = '';
      if (hasStructuredSets) {
        const exKey = ex.name;
        // Get existing set data or build default from plan
        let exSets = setsData[exKey];
        const lastSession = await Fitness.getLastSessionData(exKey, date);
        if (!exSets || exSets.length !== ex.sets) {
          // Initialize from plan — if exercise was previously checked (old format), mark all sets done
          exSets = Array.from({ length: ex.sets }, (_, si) => ({
            done: isDone,
            reps: ex.reps,
            weight: lastSession?.sets?.[si]?.weight ?? null,
          }));
        }
        // Build last session hint (e.g. "last: 3×8 @ 25 lbs")
        let lastHint = '';
        if (lastSession) {
          const lastDate = new Date(lastSession.date + 'T12:00:00');
          const daysAgo = Math.round((new Date(date + 'T12:00:00') - lastDate) / 86400000);
          const daysLabel = daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;
          const lastWeight = lastSession.sets?.find(s => s.weight)?.weight;
          const lastReps = lastSession.sets?.find(s => s.reps)?.reps;
          if (lastWeight || lastReps) {
            lastHint = `<div class="fitness-last-hint">Last (${daysLabel}): ${lastReps ? lastReps + ' reps' : ''}${lastWeight ? ' @ ' + lastWeight + ' lbs' : ''}</div>`;
          }
        }
        setRowsHtml = `<div class="fitness-sets">${lastHint}`;
        for (let s = 0; s < ex.sets; s++) {
          const setDone = exSets[s]?.done || false;
          const setReps = exSets[s]?.reps ?? ex.reps;
          const setWeight = exSets[s]?.weight ?? '';
          setRowsHtml += `
            <div class="fitness-set-row${setDone ? ' set-done' : ''}" data-exercise="${UI.escapeHtml(exKey)}" data-set="${s}">
              <span class="fitness-set-label">Set ${s + 1}</span>
              <input type="number" class="fitness-set-weight" value="${setWeight}" placeholder="lbs" inputmode="decimal" min="0" max="9999" step="2.5">
              <span class="fitness-set-x">×</span>
              <input type="number" class="fitness-set-reps" value="${setReps}" inputmode="numeric" min="0" max="999">
              <button class="fitness-set-check${setDone ? ' checked' : ''}" data-exercise="${UI.escapeHtml(exKey)}" data-set="${s}">${setDone ? '&#x2713;' : ''}</button>
            </div>
          `;
        }
        setRowsHtml += `</div>`;
      }

      html += `
        <div class="card fitness-exercise${isDone ? ' fitness-done' : ''}" data-exercise="${UI.escapeHtml(ex.name)}" style="margin-bottom:var(--space-xs);">
          <div class="fitness-exercise-row">
            <button class="fitness-check${isDone ? ' checked' : ''}" data-name="${UI.escapeHtml(ex.name)}">
              ${isDone ? '&#x2713;' : ''}
            </button>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <span class="fitness-exercise-name${isDone ? ' fitness-strikethrough' : ''}">${UI.escapeHtml(ex.name)}</span>
                ${ex.setsReps ? `<span style="font-size:var(--text-xs); color:var(--accent-green); font-weight:600; white-space:nowrap; margin-left:var(--space-sm);">${UI.escapeHtml(ex.setsReps)}</span>` : ''}
              </div>
              ${ex.extra ? `<div style="font-size:var(--text-xs); color:var(--text-muted);">${UI.escapeHtml(ex.extra)}</div>` : ''}
            </div>
            ${hasDetails ? `<button class="fitness-info-btn" data-idx="${i}" aria-label="Exercise info">?</button>` : ''}
          </div>
          ${setRowsHtml}
          <div class="fitness-details" id="fitness-detail-${i}" style="display:none;">
            ${hasDetails ? `
              <div class="fitness-detail-section">
                <div class="fitness-detail-label">Why this exercise?</div>
                <div class="fitness-detail-text">${UI.escapeHtml(ex.details.why)}</div>
              </div>
              <div class="fitness-detail-section">
                <div class="fitness-detail-label">Muscles</div>
                <div class="fitness-detail-text">${UI.escapeHtml(ex.details.muscles)}</div>
              </div>
              <div class="fitness-detail-section">
                <div class="fitness-detail-label">How to do it</div>
                <div class="fitness-detail-text">${UI.escapeHtml(ex.details.form)}</div>
              </div>
              <div class="fitness-detail-section">
                <div class="fitness-detail-label">Common mistakes</div>
                <div class="fitness-detail-text">${UI.escapeHtml(ex.details.mistakes)}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    // Notes
    html += `
      <div class="card fitness-notes-card" id="fitness-notes-card" style="margin-top:var(--space-sm); padding:var(--space-sm) var(--space-md);">
        ${notes ? `
          <div style="font-size:var(--text-xs); color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:var(--space-xs);">Notes</div>
          <textarea class="form-input fitness-notes" id="fitness-notes" placeholder="How did the workout feel? Any modifications?" rows="1" style="border:none; padding:0 0 8px; background:transparent; font-size:var(--text-sm);">${UI.escapeHtml(notes)}</textarea>
          <button class="btn btn-ghost" id="fitness-save-btn" style="margin-top:var(--space-xs); font-size:var(--text-xs); opacity:0.6;">Save</button>
        ` : `
          <button class="btn btn-ghost fitness-notes-prompt" id="fitness-notes-prompt" style="width:100%; text-align:left; color:var(--text-muted); font-size:var(--text-sm); padding:0;">+ Add notes...</button>
          <textarea class="form-input fitness-notes" id="fitness-notes" placeholder="How did the workout feel? Any modifications?" rows="2" style="display:none; border:none; padding:0 0 8px; background:transparent; font-size:var(--text-sm);"></textarea>
          <button class="btn btn-ghost" id="fitness-save-btn" style="display:none; margin-top:var(--space-xs); font-size:var(--text-xs); opacity:0.6;">Save</button>
        `}
      </div>
    `;

    return html;
  },

  // Wire up event handlers after rendering
  bindEvents(date, container) {
    const root = container || document;

    // Helper: update stat card counter based on exercise-level checkboxes
    function updateStatCard() {
      const total = root.querySelectorAll('.fitness-check').length;
      const done = root.querySelectorAll('.fitness-check.checked').length;
      const statCard = document.querySelector('[data-stat-action="workout"] .stat-value');
      if (statCard && total > 0) statCard.textContent = `${done}/${total}`;
    }

    // Helper: mark exercise card done/undone visually
    function setExerciseDone(exerciseCard, mainBtn, isDone) {
      if (isDone) {
        mainBtn.classList.add('checked');
        mainBtn.innerHTML = '&#x2713;';
        exerciseCard.classList.add('fitness-done');
        exerciseCard.querySelector('.fitness-exercise-name')?.classList.add('fitness-strikethrough');
      } else {
        mainBtn.classList.remove('checked');
        mainBtn.innerHTML = '';
        exerciseCard.classList.remove('fitness-done');
        exerciseCard.querySelector('.fitness-exercise-name')?.classList.remove('fitness-strikethrough');
      }
    }

    // Exercise-level checkbox — "complete all" toggle
    root.querySelectorAll('.fitness-check').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const exerciseCard = btn.closest('.fitness-exercise');
        const setRows = exerciseCard ? exerciseCard.querySelectorAll('.fitness-set-row') : [];
        const hasSetRows = setRows.length > 0;

        if (hasSetRows) {
          // Toggle all sets based on current state — if all checked, uncheck all; else check all
          const allChecked = [...setRows].every(row => row.classList.contains('set-done'));
          const newDone = !allChecked;

          const setsData = await Fitness.getSetsData(date);
          if (!setsData[name]) setsData[name] = [];

          setRows.forEach((row, idx) => {
            const setCheck = row.querySelector('.fitness-set-check');
            const repsInput = row.querySelector('.fitness-set-reps');
            const weightInput = row.querySelector('.fitness-set-weight');
            const repsVal = repsInput ? parseInt(repsInput.value, 10) || 0 : 0;
            const weightVal = weightInput ? parseFloat(weightInput.value) || null : null;
            if (!setsData[name][idx]) setsData[name][idx] = {};
            setsData[name][idx].done = newDone;
            setsData[name][idx].reps = repsVal;
            setsData[name][idx].weight = weightVal;
            if (newDone) {
              row.classList.add('set-done');
              if (setCheck) { setCheck.classList.add('checked'); setCheck.innerHTML = '&#x2713;'; }
            } else {
              row.classList.remove('set-done');
              if (setCheck) { setCheck.classList.remove('checked'); setCheck.innerHTML = ''; }
            }
          });

          await Fitness.saveSetsData(date, setsData);
          setExerciseDone(exerciseCard, btn, newDone);

          // Sync fitness_checked
          const checked = await Fitness.getCheckedExercises(date);
          if (newDone) checked.add(name); else checked.delete(name);
          await Fitness.saveCheckedExercises(date, checked);
        } else {
          // No set rows — simple toggle (legacy/cardio exercises)
          const checked = await Fitness.getCheckedExercises(date);
          const isDone = checked.has(name);
          if (isDone) {
            checked.delete(name);
            setExerciseDone(exerciseCard, btn, false);
          } else {
            checked.add(name);
            setExerciseDone(exerciseCard, btn, true);
          }
          await Fitness.saveCheckedExercises(date, checked);
        }

        updateStatCard();
      });
    });

    // Set-level checkbox — toggle individual set
    root.querySelectorAll('.fitness-set-check').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const exName = btn.dataset.exercise;
        const setIdx = parseInt(btn.dataset.set, 10);
        const setRow = btn.closest('.fitness-set-row');
        const repsInput = setRow?.querySelector('.fitness-set-reps');
        const weightInput = setRow?.querySelector('.fitness-set-weight');
        const repsVal = repsInput ? parseInt(repsInput.value, 10) || 0 : 0;
        const weightVal = weightInput ? parseFloat(weightInput.value) || null : null;

        const setsData = await Fitness.getSetsData(date);
        if (!setsData[exName]) setsData[exName] = [];
        if (!setsData[exName][setIdx]) setsData[exName][setIdx] = {};

        const wasDone = setsData[exName][setIdx].done || false;
        const nowDone = !wasDone;
        setsData[exName][setIdx].done = nowDone;
        setsData[exName][setIdx].reps = repsVal;
        setsData[exName][setIdx].weight = weightVal;

        // Update set row visuals
        if (nowDone) {
          setRow.classList.add('set-done');
          btn.classList.add('checked');
          btn.innerHTML = '&#x2713;';
        } else {
          setRow.classList.remove('set-done');
          btn.classList.remove('checked');
          btn.innerHTML = '';
        }

        await Fitness.saveSetsData(date, setsData);

        // Check if all sets in this exercise are now done/undone
        const exerciseCard = btn.closest('.fitness-exercise');
        const allSetRows = exerciseCard ? exerciseCard.querySelectorAll('.fitness-set-row') : [];
        const allDone = [...allSetRows].every(row => row.classList.contains('set-done'));
        const mainBtn = exerciseCard?.querySelector('.fitness-check');

        if (mainBtn) setExerciseDone(exerciseCard, mainBtn, allDone);

        // Sync fitness_checked
        const checked = await Fitness.getCheckedExercises(date);
        if (allDone) checked.add(exName); else checked.delete(exName);
        await Fitness.saveCheckedExercises(date, checked);

        updateStatCard();

        // Trigger sync
        if (await CloudRelay.isConfigured()) {
          CloudRelay.queueUpload(date);
        }
      });
    });

    // Rep count input — save on change/blur (debounced)
    root.querySelectorAll('.fitness-set-reps').forEach(input => {
      let repTimer = null;
      const saveReps = async () => {
        const setRow = input.closest('.fitness-set-row');
        if (!setRow) return;
        const exName = setRow.dataset.exercise;
        const setIdx = parseInt(setRow.dataset.set, 10);
        const repsVal = parseInt(input.value, 10) || 0;

        const setsData = await Fitness.getSetsData(date);
        if (!setsData[exName]) setsData[exName] = [];
        if (!setsData[exName][setIdx]) setsData[exName][setIdx] = {};
        setsData[exName][setIdx].reps = repsVal;
        await Fitness.saveSetsData(date, setsData);
      };

      input.addEventListener('change', () => {
        clearTimeout(repTimer);
        repTimer = setTimeout(saveReps, 500);
      });
      input.addEventListener('blur', () => {
        clearTimeout(repTimer);
        saveReps();
      });
    });

    // Weight input — save on change/blur (debounced)
    root.querySelectorAll('.fitness-set-weight').forEach(input => {
      let weightTimer = null;
      const saveWeight = async () => {
        const setRow = input.closest('.fitness-set-row');
        if (!setRow) return;
        const exName = setRow.dataset.exercise;
        const setIdx = parseInt(setRow.dataset.set, 10);
        const weightVal = parseFloat(input.value) || null;

        const setsData = await Fitness.getSetsData(date);
        if (!setsData[exName]) setsData[exName] = [];
        if (!setsData[exName][setIdx]) setsData[exName][setIdx] = {};
        setsData[exName][setIdx].weight = weightVal;
        await Fitness.saveSetsData(date, setsData);
      };

      input.addEventListener('change', () => {
        clearTimeout(weightTimer);
        weightTimer = setTimeout(saveWeight, 500);
      });
      input.addEventListener('blur', () => {
        clearTimeout(weightTimer);
        saveWeight();
      });
    });

    // Info expand/collapse
    root.querySelectorAll('.fitness-info-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const detail = root.querySelector(`#fitness-detail-${btn.dataset.idx}`);
        if (detail) {
          const isOpen = detail.style.display !== 'none';
          detail.style.display = isOpen ? 'none' : 'block';
          btn.textContent = isOpen ? '?' : '\u2715';
        }
      });
    });

    // Notes — expand prompt, save button, auto-save fallback
    clearTimeout(Fitness._saveTimer);
    const notesEl = root.querySelector('#fitness-notes');
    const saveBtn = root.querySelector('#fitness-save-btn');
    const notesPrompt = root.querySelector('#fitness-notes-prompt');

    // "Add notes..." prompt — tap to reveal textarea
    if (notesPrompt && notesEl && saveBtn) {
      notesPrompt.addEventListener('click', () => {
        notesPrompt.style.display = 'none';
        notesEl.style.display = 'block';
        saveBtn.style.display = 'inline-block';
        UI.autoResize(notesEl);
        notesEl.focus();
      });
    }

    if (notesEl) {
      UI.autoResize(notesEl);
      notesEl.addEventListener('input', () => {
        UI.autoResize(notesEl);
        clearTimeout(Fitness._saveTimer);
        if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.style.opacity = '1'; }
        Fitness._saveTimer = setTimeout(() => {
          Fitness.saveWorkoutNotes(date, notesEl.value);
        }, 3000);
      });
    }
    if (saveBtn && notesEl) {
      saveBtn.addEventListener('click', async () => {
        clearTimeout(Fitness._saveTimer);
        await Fitness.saveWorkoutNotes(date, notesEl.value);
        saveBtn.textContent = 'Saved!';
        saveBtn.style.opacity = '0.6';
        // Also trigger sync
        if (await CloudRelay.isConfigured()) {
          CloudRelay.queueUpload(date);
        }
      });
    }
  },

  // Persistence — store checked exercises and notes in dailySummary
  async getCheckedExercises(date) {
    const summary = await DB.getDailySummary(date);
    // Derive from fitness_sets if available — exercise is checked when ALL its sets are done
    if (summary.fitness_sets && Object.keys(summary.fitness_sets).length > 0) {
      const checked = new Set();
      for (const [exName, sets] of Object.entries(summary.fitness_sets)) {
        if (Array.isArray(sets) && sets.length > 0 && sets.every(s => s.done)) {
          checked.add(exName);
        }
      }
      // Also include any legacy fitness_checked entries not yet in fitness_sets
      for (const name of (summary.fitness_checked || [])) {
        checked.add(name);
      }
      return checked;
    }
    // Fall back to legacy fitness_checked
    return new Set(summary.fitness_checked || []);
  },

  async saveCheckedExercises(date, checkedSet) {
    // Keep fitness_checked in sync for backward compat with processing/analysis
    await DB.updateDailySummary(date, { fitness_checked: [...checkedSet] });
  },

  async getSetsData(date) {
    const summary = await DB.getDailySummary(date);
    return summary.fitness_sets || {};
  },

  async saveSetsData(date, setsObj) {
    await DB.updateDailySummary(date, { fitness_sets: setsObj });
    if (await CloudRelay.isConfigured()) {
      CloudRelay.queueUpload(date);
    }
  },

  async getWorkoutNotes(date) {
    const summary = await DB.getDailySummary(date);
    return summary.fitness_notes || '';
  },

  async saveWorkoutNotes(date, notes) {
    await DB.updateDailySummary(date, { fitness_notes: notes });
  },

  // Return the most recent completed set data for an exercise before a given date
  async getLastSessionData(exerciseName, beforeDate) {
    const all = await DB.getAllDailySummaries();
    const sorted = all
      .filter(s => s.date < beforeDate && s.fitness_sets && s.fitness_sets[exerciseName])
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!sorted.length) return null;
    return { date: sorted[0].date, sets: sorted[0].fitness_sets[exerciseName] };
  },

  // Return number of consecutive days (up to 7) with no completed workout before a given date
  async getDaysWithoutWorkout(beforeDate) {
    const start = new Date(beforeDate + 'T12:00:00');
    start.setDate(start.getDate() - 7);
    const startStr = start.toISOString().slice(0, 10);
    const summaries = await DB.getDailySummaryRange(startStr, beforeDate);
    // Walk backwards from yesterday
    let count = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(beforeDate + 'T12:00:00');
      d.setDate(d.getDate() - (i + 1));
      const dateStr = d.toISOString().slice(0, 10);
      const summary = summaries.find(s => s.date === dateStr);
      const hadWorkout = summary?.fitness_sets &&
        Object.values(summary.fitness_sets).some(sets =>
          Array.isArray(sets) && sets.some(s => s.done)
        );
      if (hadWorkout) break;
      count++;
    }
    return count;
  },
};
