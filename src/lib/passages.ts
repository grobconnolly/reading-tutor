/* Leveled library passages, ported from version 1. Two per level, ids like "3a". */

export interface Question {
  q: string;
  options: string[];
  /** Index of the correct option. Library and AI passages store 0; options are shuffled at display time. */
  a: number;
}

export interface Passage {
  id: string;
  level: number;
  title: string;
  text: string;
  questions: Question[];
  source: "library" | "ai";
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 7;

/** Grade label for each reading level. Shown ONLY in the parent view, never to a reader. */
export const LEVELS: Record<number, string> = {
  1: "Grade 1",
  2: "Grade 2",
  3: "Grade 2–3",
  4: "Grade 3",
  5: "Grade 3–4",
  6: "Grade 4",
  7: "Grade 5",
};

/** Target word count for AI-written stories at each level. */
export const LEVEL_WORDS: Record<number, number> = { 1: 60, 2: 80, 3: 100, 4: 120, 5: 130, 6: 140, 7: 150 };

/**
 * Approximate fall-of-year average oral reading fluency (words correct per minute) by school grade,
 * 50th percentile, after Hasbrouck & Tindal (2017). Keyed by school grade so it is easy to edit.
 */
export const GRADE_FALL_WCPM: Record<number, number> = { 2: 50, 3: 83, 4: 94, 5: 110, 6: 127, 7: 128, 8: 133 };

export function gradeLabel(level: number): string {
  return LEVELS[level] ?? `Level ${level}`;
}

export function ordinalGrade(grade: number): string {
  const s = grade === 1 ? "st" : grade === 2 ? "nd" : grade === 3 ? "rd" : "th";
  return `${grade}${s} grade`;
}

export const PASSAGES: Passage[] = [
 {id:"1a",level:1,source:"library",title:"The Big Dog",text:"Max is a big dog. He likes to run and jump. Max runs to the park with Sam. Sam has a red ball. He throws the ball up high. Max jumps and gets it! Then Max drops the ball in the mud. Now the ball is not red. It is brown. Sam laughs. Max wags his tail. It is time for a bath.",
  questions:[{q:"What does Sam throw?",options:["A red ball","A stick","A hat","A bone"],a:0},{q:"Why is the ball brown?",options:["It fell in the mud","Sam painted it","It was old","Max chewed it"],a:0},{q:"How does Sam feel when the ball gets muddy?",options:["He thinks it is funny","He is sad","He is angry","He is scared"],a:0}]},
 {id:"1b",level:1,source:"library",title:"Fish at the Lake",text:"Mia and her dad go to the lake. They sit on a log and fish. Dad gets a little fish. Mia waits and waits. Then her line pulls hard! She holds on tight. It is a big fish! Dad helps her pull it in. Mia looks at the fish. Then she lets it go back in the lake. The fish swims away fast.",
  questions:[{q:"Where do Mia and her dad go?",options:["To a lake","To a store","To the beach","To school"],a:0},{q:"Who helps Mia pull the fish in?",options:["Her dad","Her mom","Her friend","Nobody"],a:0},{q:"What does Mia do with the big fish?",options:["She lets it go","She eats it","She takes it home","She gives it to Dad"],a:0}]},
 {id:"2a",level:2,source:"library",title:"The Lost Lunch",text:"Leo opened his backpack at lunch, but his lunch box was not inside. His stomach growled. He looked under his desk and in his cubby. It was not there. Then he remembered. He had set it on the kitchen counter that morning while he tied his shoes. Leo felt grumpy. His friend Ava saw his sad face. She broke her sandwich in half and gave him the bigger piece. Leo smiled. \"Tomorrow I will share my cookies with you,\" he said.",
  questions:[{q:"Where was Leo's lunch box?",options:["On the kitchen counter","Under his desk","In his cubby","On the bus"],a:0},{q:"What did Ava share with Leo?",options:["Half of her sandwich","Her cookies","Her apple","Her juice"],a:0},{q:"What does the word grumpy mean in the story?",options:["In a bad mood","Very sleepy","Very hungry","Excited"],a:0}]},
 {id:"2b",level:2,source:"library",title:"How Seeds Grow",text:"Plants grow from seeds. A seed is like a tiny box with a baby plant inside. The seed needs three things to start growing. It needs water, warm air, and soil. First, a root pushes down into the dirt. The root drinks water for the plant. Next, a small green shoot pokes up toward the sun. The shoot grows leaves. The leaves use sunlight to make food. In a few weeks, the tiny seed can become a tall plant.",
  questions:[{q:"What grows first from the seed?",options:["The root","The leaves","A flower","The fruit"],a:0},{q:"What do the leaves use to make food?",options:["Sunlight","Rocks","Wind","Snow"],a:0},{q:"Which of these does a seed need to grow?",options:["Warm air","Loud music","Ice","Total darkness"],a:0}]},
 {id:"3a",level:3,source:"library",title:"The Rookie",text:"Carlos was the youngest player on his baseball team. He was small, but he was quick. During the big game, his team was losing by one run. It was the last inning, and Carlos was up to bat. His hands were shaking. The first pitch zoomed past him. Strike one! Carlos took a deep breath and remembered what his coach always said: \"Watch the ball all the way to the bat.\" The next pitch came, and Carlos swung. Crack! The ball flew over the second baseman's head. Carlos raced to first base while his teammate ran home. The game was tied, and his team cheered his name.",
  questions:[{q:"Why were Carlos's hands shaking?",options:["He was nervous","He was cold","He was hurt","He was tired"],a:0},{q:"What did his coach always tell him?",options:["Watch the ball all the way to the bat","Swing as hard as you can","Run fast to first base","Never strike out"],a:0},{q:"What happened because of Carlos's hit?",options:["The game was tied","His team lost","The game was canceled","Carlos got hurt"],a:0}]},
 {id:"3b",level:3,source:"library",title:"Sea Turtles",text:"Sea turtles have lived in the ocean for millions of years. They spend almost their whole lives swimming in the sea. A mother turtle comes onto the beach only to lay her eggs. At night, she digs a deep hole in the sand with her flippers. She lays about one hundred eggs, covers them up, and returns to the water. After about two months, the baby turtles hatch. They dig their way out of the sand and race toward the ocean. Many dangers wait for them, like birds and crabs. Only a few babies grow up, but those that do can live for more than fifty years.",
  questions:[{q:"Why does a mother sea turtle come onto the beach?",options:["To lay her eggs","To find food","To sleep","To get warm"],a:0},{q:"What do baby turtles do after they hatch?",options:["Race toward the ocean","Stay in the nest","Look for their mother","Climb trees"],a:0},{q:"In this story, what are dangers?",options:["Things that can hurt you","Kinds of food","Places to hide","Ocean waves"],a:0}]},
 {id:"4a",level:4,source:"library",title:"The Science Fair",text:"Nina wanted to win the science fair, but she could not think of a good idea. Her brother suggested a volcano, but everyone made volcanoes. One morning, Nina noticed that the bread on the counter had fuzzy green spots. \"That's mold,\" her mother explained. \"It grows faster in some places than others.\" Nina had her idea. She put three slices of bread in three different places: the refrigerator, a dark cabinet, and a sunny windowsill. Every day she checked them and wrote notes in her journal. After one week, the bread in the dark cabinet was the moldiest. The bread in the refrigerator barely changed. Nina did not win first place, but the judges said her project was the most original in the whole school.",
  questions:[{q:"What gave Nina her idea?",options:["Moldy bread on the counter","Her brother's volcano","A library book","Her teacher"],a:0},{q:"Where did the bread change the least?",options:["In the refrigerator","In the dark cabinet","On the windowsill","In her backpack"],a:0},{q:"The judges said her project was original. What does original mean?",options:["New and different","Very old","Hard to understand","Too small"],a:0}]},
 {id:"4b",level:4,source:"library",title:"Animal Teamwork",text:"Some animals survive by working together. Wolves live and hunt in groups called packs. By working as a team, a pack can catch animals much bigger than a single wolf could. Honeybees also depend on teamwork. Inside a hive, thousands of bees share the work. Some bees gather nectar from flowers, some guard the entrance, and others take care of the young. Even tiny ants cooperate. When an ant finds food, it leaves a scent trail on the ground. Other ants follow the trail and help carry the food home. For these creatures, being part of a group is the key to staying alive.",
  questions:[{q:"What is a group of wolves called?",options:["A pack","A hive","A herd","A team"],a:0},{q:"How does an ant show other ants where food is?",options:["It leaves a scent trail","It makes a loud noise","It draws a map","It flies back"],a:0},{q:"What is this passage mostly about?",options:["Animals working together to survive","How wolves hunt alone","Why bees make honey","How to keep ants away"],a:0}]},
 {id:"5a",level:5,source:"library",title:"The Storm",text:"The wind had been rising all afternoon, and by dinnertime the sky over the farm had turned a strange greenish gray. Grandpa kept glancing out the window. \"Jada, help me bring the goats into the barn,\" he said, grabbing his raincoat. Outside, the first heavy raindrops smacked against Jada's face. The goats were nervous and kept running in circles, but Jada remembered a trick. She shook a bucket of grain, and the goats followed the familiar sound straight through the barn doors. Just as Grandpa latched the doors, a crack of thunder shook the ground. Back in the farmhouse, they watched the storm through the window, dripping wet but relieved. \"You saved us a lot of trouble tonight,\" Grandpa told her proudly.",
  questions:[{q:"How did Jada get the goats into the barn?",options:["She shook a bucket of grain","She chased them","She called their names","Grandpa carried them"],a:0},{q:"Why did Grandpa keep glancing out the window?",options:["He was worried about the storm","He was waiting for a visitor","He saw a fox","He wanted to go outside and play"],a:0},{q:"How did Jada and Grandpa feel at the end?",options:["Relieved","Angry","Bored","Lost"],a:0}]},
 {id:"5b",level:5,source:"library",title:"Inside a Volcano",text:"Deep beneath Earth's surface, the rock is so hot that some of it melts into a thick liquid called magma. Magma is lighter than the solid rock around it, so it slowly rises. Sometimes it collects in a chamber underneath a mountain. When enough pressure builds up, the magma bursts through cracks in the surface. Once magma reaches the outside, scientists call it lava. Lava can be hotter than two thousand degrees and glows orange and red as it flows. Over many eruptions, layers of cooled lava and ash pile up and build the volcano taller. Scientists who study volcanoes are called volcanologists, and they watch for warning signs like small earthquakes so that people can leave before an eruption.",
  questions:[{q:"What is magma called once it reaches the surface?",options:["Lava","Ash","Crystal","Steam"],a:0},{q:"Why does magma rise?",options:["It is lighter than the rock around it","The wind pulls it up","Volcanologists pump it","It is colder than the rock"],a:0},{q:"Why do volcanologists watch for small earthquakes?",options:["So people can leave before an eruption","To make the volcano bigger","To find gold","To stop the lava"],a:0}]},
 {id:"6a",level:6,source:"library",title:"The Comeback",text:"Ever since she fell during the regional gymnastics meet, Priya had avoided the balance beam. Every time she climbed onto it, her legs trembled and her mind replayed the moment she slipped. Her coach, Ms. Okafor, noticed and suggested a different approach. \"Let's start on the floor,\" she said, placing a strip of tape on the mat. For a week, Priya practiced her routine on that narrow line of tape, where falling was impossible. Gradually, her movements became smooth and confident again. Next, they moved to a low beam only a few inches off the ground. By the end of the month, Priya was back on the competition beam, performing her routine without a single wobble. She realized that conquering fear did not happen all at once; it happened one small step at a time.",
  questions:[{q:"Why had Priya been avoiding the balance beam?",options:["She fell at a meet and was afraid","She hurt her arm","She did not like her coach","The beam was broken"],a:0},{q:"Why did Ms. Okafor have Priya practice on tape first?",options:["She could not fall, so she could build confidence","The gym was closed","Tape is harder than a beam","Priya asked to quit"],a:0},{q:"What lesson does Priya learn?",options:["Fear can be beaten one small step at a time","Gymnastics is too dangerous","Coaches are always right","Practice is a waste of time"],a:0}]},
 {id:"6b",level:6,source:"library",title:"Glowing Waves",text:"On certain nights, the waves along some beaches glow an eerie electric blue. This dazzling light is not caused by pollution or magic. It comes from billions of tiny living things called dinoflagellates. These creatures are a kind of plankton, too small to see without a microscope. When the water around them is disturbed, a chemical reaction inside their bodies produces light. This ability is called bioluminescence. Scientists believe the glow may protect the plankton. A sudden flash can startle a predator, or it can attract even larger animals that hunt the predator. Many other organisms use bioluminescence too, including fireflies, certain mushrooms, and fish that live in the deepest parts of the ocean, where sunlight never reaches.",
  questions:[{q:"What makes the waves glow?",options:["Billions of tiny plankton","Pollution","The moon","Lights on the beach"],a:0},{q:"What makes the plankton light up?",options:["The water around them is disturbed","The sun goes down","They get hungry","They get cold"],a:0},{q:"How might glowing protect the plankton?",options:["A flash can startle a predator","It keeps them warm","It helps them swim faster","It makes them taste bad"],a:0}]},
 {id:"7a",level:7,source:"library",title:"The Inventor's Notebook",text:"When twelve-year-old Theo discovered his great-grandmother's notebook in the attic, he expected recipes or old shopping lists. Instead, the yellowed pages were crowded with sketches of strange machines, each labeled in tiny, precise handwriting. One drawing showed a device for collecting rainwater from rooftops and filtering it for drinking. Another described a bicycle that could power a lamp as the rider pedaled. Theo was astonished. Nobody in his family had ever mentioned that she was an inventor. He brought the notebook to his science teacher, who helped him research the designs. They discovered that his great-grandmother had applied for a patent in the nineteen-forties but had been rejected without explanation. Determined to honor her work, Theo built a working model of the bicycle lamp for the regional science competition, and he proudly displayed her original sketches beside it.",
  questions:[{q:"What did Theo expect to find in the notebook?",options:["Recipes or shopping lists","Drawings of machines","Old photos","A treasure map"],a:0},{q:"What happened when his great-grandmother applied for a patent?",options:["She was rejected","She became famous","She sold her invention","She never finished it"],a:0},{q:"Why did Theo display her sketches next to his model?",options:["To honor her and give her credit","Because his teacher made him","To win money","Because he lost his own drawings"],a:0}]},
 {id:"7b",level:7,source:"library",title:"The Monarch Mystery",text:"Every autumn, millions of monarch butterflies begin one of the most remarkable journeys in the animal kingdom. Monarchs from Canada and the northern United States fly as far as three thousand miles south to the mountain forests of central Mexico. What makes this migration so mysterious is that no single butterfly ever completes the round trip. The monarchs that fly south are the great-grandchildren of the butterflies that left Mexico the previous spring. Somehow, they find the same forests their ancestors visited, even though they have never been there before. Scientists believe monarchs use the position of the sun and possibly Earth's magnetic field to navigate. Unfortunately, monarch populations have declined because of habitat loss, so many communities now plant milkweed, the only plant monarch caterpillars can eat.",
  questions:[{q:"Where do monarchs fly in the autumn?",options:["The forests of central Mexico","Canada","The Arctic","South America"],a:0},{q:"Why is the monarch migration a mystery?",options:["They find forests they have never visited","They fly backwards","They only fly at night","Nobody has seen them fly"],a:0},{q:"Why do communities plant milkweed?",options:["It is the only food monarch caterpillars eat","It smells nice","It keeps birds away","It grows fast"],a:0}]}
];

/** The "a" passage at a level, used by the reading check. */
export function checkPassageFor(level: number): Passage {
  const p = PASSAGES.find((x) => x.level === level && x.id.endsWith("a"));
  if (!p) throw new Error(`No check passage for level ${level}`);
  return p;
}
