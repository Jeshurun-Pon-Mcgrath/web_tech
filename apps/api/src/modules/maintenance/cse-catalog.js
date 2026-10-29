// Fictional teaching fixtures, not real student activity or an institutional syllabus.
// Each subject supplies single-choice, exact-set multiple-choice and true/false examples.
const single = (prompt, options, explanation) => ({
  type: 'single',
  prompt,
  options,
  correct: [0],
  explanation,
});
const multiple = (prompt, options, correct, explanation) => ({
  type: 'multiple',
  prompt,
  options,
  correct,
  explanation,
});
const boolean = (prompt, correct, explanation) => ({
  type: 'true-false',
  prompt,
  options: ['True', 'False'],
  correct: [correct ? 0 : 1],
  explanation,
});
export const cseCatalog = [
  [
    'DS',
    'Data Structures',
    'structures',
    [
      single(
        'Which data structure follows last-in, first-out order?',
        ['Stack', 'Queue', 'Heap', 'Graph'],
        'A stack removes the most recently pushed item first.',
      ),
      multiple(
        'Select the non-linear data structures.',
        ['Tree', 'Graph', 'Array', 'Linked list'],
        [0, 1],
        'Trees and graphs organize relationships beyond a single linear sequence.',
      ),
      boolean(
        'Binary search requires the searched sequence to be sorted according to its comparison order.',
        true,
        'Ordering allows binary search to discard half of the remaining range.',
      ),
    ],
  ],
  [
    'DAA',
    'Design and Analysis of Algorithms',
    'complexity',
    [
      single(
        'What is the worst-case search complexity of binary search on a sorted array?',
        ['O(log n)', 'O(n)', 'O(n log n)', 'O(n squared)'],
        'Each step approximately halves the search range.',
      ),
      multiple(
        'Which sorting algorithms can retain the original order of equal keys in their standard stable implementations?',
        ['Merge sort', 'Insertion sort', 'Heap sort', 'In-place quicksort'],
        [0, 1],
        'Merge sort with stable merging and insertion sort preserve equal-key order.',
      ),
      boolean(
        'Standard quicksort can take quadratic time with consistently unbalanced partitions.',
        true,
        'Repeated partitions of sizes zero and n minus one produce quadratic work.',
      ),
    ],
  ],
  [
    'DBMS',
    'Database Management Systems',
    'relational-data',
    [
      single(
        'Which SQL statement retrieves rows from a table?',
        ['SELECT', 'INSERT', 'DELETE', 'ALTER'],
        'SELECT queries data without inserting or deleting rows.',
      ),
      multiple(
        'Which are relational database key constraints?',
        ['PRIMARY KEY', 'FOREIGN KEY', 'ORDER BY', 'GROUP BY'],
        [0, 1],
        'Primary and foreign keys constrain identity and references; the other choices are query clauses.',
      ),
      boolean(
        'In SQL, comparing a column to NULL with = is the correct test for missing values.',
        false,
        'Use IS NULL; ordinary comparisons with NULL evaluate to unknown.',
      ),
    ],
  ],
  [
    'OS',
    'Operating Systems',
    'processes',
    [
      single(
        'Which component selects the next ready process to run on the CPU?',
        ['CPU scheduler', 'Linker', 'Compiler', 'Text editor'],
        'The CPU scheduler selects a process from the ready queue.',
      ),
      multiple(
        'Select necessary conditions in the classical Coffman deadlock model.',
        ['Mutual exclusion', 'Circular wait', 'Unlimited resources', 'Mandatory preemption'],
        [0, 1],
        'Mutual exclusion, hold-and-wait, no preemption and circular wait are the four conditions.',
      ),
      boolean(
        'Fixed-size paging can cause internal fragmentation in the last page of an allocation.',
        true,
        'The final allocated page may not be completely used.',
      ),
    ],
  ],
  [
    'CN',
    'Computer Networks',
    'protocols',
    [
      single(
        'At which TCP/IP layer does TCP operate?',
        ['Transport', 'Application', 'Internet', 'Link'],
        'TCP provides transport-layer services between endpoints.',
      ),
      multiple(
        'Select application-layer protocols.',
        ['HTTP', 'DNS', 'IP', 'Ethernet'],
        [0, 1],
        'HTTP and DNS operate at the application layer.',
      ),
      boolean(
        'UDP guarantees delivery in the same order that datagrams were sent.',
        false,
        'UDP itself does not guarantee delivery or ordering.',
      ),
    ],
  ],
  [
    'COA',
    'Computer Organization and Architecture',
    'processor',
    [
      single(
        'Which CPU unit performs arithmetic and bitwise operations?',
        ['ALU', 'Network card', 'Disk controller', 'Printer'],
        'The arithmetic logic unit performs these operations.',
      ),
      multiple(
        'Which storage types are typically volatile?',
        ['DRAM main memory', 'SRAM CPU cache', 'Flash SSD', 'ROM'],
        [0, 1],
        'DRAM and SRAM lose their stored values when power is removed.',
      ),
      boolean(
        'CPU registers provide storage directly within the processor.',
        true,
        'Registers hold operands, addresses and execution state inside the CPU.',
      ),
    ],
  ],
  [
    'OOP',
    'Object-Oriented Programming',
    'objects',
    [
      single(
        'Which principle groups data with methods and controls access to internal state?',
        ['Encapsulation', 'Packet switching', 'Normalization', 'Paging'],
        'Encapsulation defines a controlled interface around an object.',
      ),
      multiple(
        'Select object-oriented programming concepts.',
        ['Inheritance', 'Polymorphism', 'Disk partitioning', 'Packet routing'],
        [0, 1],
        'Inheritance and polymorphism are object-oriented concepts.',
      ),
      boolean(
        'A Java class can directly extend multiple concrete classes.',
        false,
        'Java classes have single class inheritance, although they may implement multiple interfaces.',
      ),
    ],
  ],
  [
    'C',
    'Programming in C',
    'c-basics',
    [
      single(
        'Which standard C header declares malloc?',
        ['stdlib.h', 'stdio.h', 'string.h', 'math.h'],
        'Memory allocation functions are declared in stdlib.h.',
      ),
      multiple(
        'Which are iteration statements in C?',
        ['for', 'while', 'typedef', 'struct'],
        [0, 1],
        'for and while repeat execution of a statement or block.',
      ),
      boolean(
        'C automatically performs runtime bounds checks on every ordinary array access.',
        false,
        'Ordinary C array access does not automatically enforce array bounds.',
      ),
    ],
  ],
  [
    'PY',
    'Python Programming',
    'python-basics',
    [
      single(
        'Which Python built-in type maps keys to values?',
        ['dict', 'list', 'set', 'tuple'],
        'A dictionary associates hashable keys with values.',
      ),
      multiple(
        'Select immutable Python built-in types.',
        ['tuple', 'str', 'list', 'dict'],
        [0, 1],
        'Tuples and strings cannot be modified in place.',
      ),
      boolean(
        'Python uses indentation to define the grouping of statements in a block.',
        true,
        'Indentation is part of Python syntax.',
      ),
    ],
  ],
  [
    'JAVA',
    'Java Programming',
    'java-basics',
    [
      single(
        'Which runtime executes Java bytecode?',
        ['JVM', 'CSS engine', 'SQL optimizer', 'Assembler only'],
        'The Java Virtual Machine executes bytecode.',
      ),
      multiple(
        'Select checked exception types in Java.',
        ['IOException', 'SQLException', 'NullPointerException', 'ArithmeticException'],
        [0, 1],
        'IOException and SQLException are checked exceptions; the other two extend RuntimeException.',
      ),
      boolean(
        'String.equals compares the character content of two Java strings.',
        true,
        'String overrides equals to compare content rather than object identity.',
      ),
    ],
  ],
  [
    'WEB',
    'Web Technology',
    'web-applications',
    [
      single(
        'Which HTML element represents a self-contained composition?',
        ['article', 'div', 'span', 'br'],
        'article carries semantic meaning for independently reusable content.',
      ),
      multiple(
        'Select React hooks used in function components.',
        ['useState', 'useEffect', 'querySelector', 'innerHTML'],
        [0, 1],
        'useState and useEffect are hooks; querySelector is a DOM method and innerHTML is a DOM property.',
      ),
      boolean(
        'HTTPS uses TLS to secure HTTP transport.',
        true,
        'TLS provides encryption and authentication for HTTPS transport.',
      ),
    ],
  ],
  [
    'SE',
    'Software Engineering',
    'development-process',
    [
      single(
        'Which tool primarily provides distributed source version control?',
        ['Git', 'MongoDB', 'Nginx', 'Figma'],
        'Git records revisions and supports distributed repositories.',
      ),
      multiple(
        'Select software testing levels.',
        ['Unit testing', 'Integration testing', 'Encryption', 'Index creation'],
        [0, 1],
        'Unit and integration testing check individual units and their interactions.',
      ),
      boolean(
        'Agile development can incorporate changing requirements through iterative planning.',
        true,
        'Iterative planning and feedback support adaptation to change.',
      ),
    ],
  ],
  [
    'TOC',
    'Theory of Computation',
    'automata',
    [
      single(
        'Which model recognizes exactly the regular languages?',
        [
          'Deterministic finite automaton',
          'Unrestricted Turing machine',
          'General pushdown automaton',
          'Relational database',
        ],
        'DFAs recognize exactly the regular languages.',
      ),
      multiple(
        'Which models recognize exactly the regular languages?',
        ['DFA', 'NFA', 'General pushdown automaton', 'General Turing machine'],
        [0, 1],
        'DFAs and NFAs have the same language-recognition power.',
      ),
      boolean(
        'Every context-free language is regular.',
        false,
        'Regular languages are a proper subset of context-free languages.',
      ),
    ],
  ],
  [
    'CD',
    'Compiler Design',
    'compilation',
    [
      single(
        'Which compilation phase groups source characters into tokens?',
        ['Lexical analysis', 'Code generation', 'Register allocation', 'Linking'],
        'The lexer recognizes tokens such as identifiers and keywords.',
      ),
      multiple(
        'Select families of syntax parsing algorithms.',
        ['LL', 'LR', 'LRU', 'FIFO'],
        [0, 1],
        'LL and LR are parser families; LRU and FIFO are replacement or ordering strategies.',
      ),
      boolean(
        'In a conventional compiler pipeline, lexical analysis precedes syntax analysis.',
        true,
        'The parser consumes the token stream produced by lexical analysis.',
      ),
    ],
  ],
  [
    'DM',
    'Discrete Mathematics',
    'logic',
    [
      single(
        'Which Boolean operation is true only when both operands are true?',
        ['AND', 'OR', 'XOR', 'NAND'],
        'Conjunction requires both operands to be true.',
      ),
      multiple(
        'Which properties define an equivalence relation?',
        ['Reflexivity', 'Symmetry', 'Transitivity', 'Irreflexivity'],
        [0, 1, 2],
        'An equivalence relation is reflexive, symmetric and transitive.',
      ),
      boolean(
        'An undirected tree is connected and contains no cycles.',
        true,
        'Connectedness and acyclicity characterize an undirected tree.',
      ),
    ],
  ],
  [
    'AI',
    'Artificial Intelligence',
    'search',
    [
      single(
        'Which learning setting uses examples with target labels?',
        [
          'Supervised learning',
          'Unsupervised clustering only',
          'Random guessing',
          'Disk scheduling',
        ],
        'Supervised learning fits input-to-target relationships from labelled examples.',
      ),
      multiple(
        'Select heuristic-informed search strategies.',
        [
          'A-star search',
          'Greedy best-first search',
          'Uninformed breadth-first search',
          'Uninformed depth-first search',
        ],
        [0, 1],
        'A-star and greedy best-first search use heuristic estimates.',
      ),
      boolean(
        'Correlation between two variables by itself proves causation.',
        false,
        'Confounding and other explanations can produce correlation without causation.',
      ),
    ],
  ],
  [
    'ML',
    'Machine Learning',
    'model-evaluation',
    [
      single(
        'What is a common sign of overfitting?',
        [
          'High training accuracy but poor unseen-data accuracy',
          'Identical features in every dataset',
          'No model parameters',
          'A smaller source file',
        ],
        'Overfitting captures training-specific patterns that fail to generalize.',
      ),
      multiple(
        'Which methods can directly perform supervised classification?',
        [
          'Logistic regression',
          'Classification decision tree',
          'K-means clustering',
          'Principal component analysis',
        ],
        [0, 1],
        'Logistic regression and classification trees learn labelled classification targets.',
      ),
      boolean(
        'Using test-set labels during training preserves an unbiased final test evaluation.',
        false,
        'This leaks evaluation information and makes test estimates unreliable.',
      ),
    ],
  ],
  [
    'SEC',
    'Cyber Security',
    'security-basics',
    [
      single(
        'Which choice is intended for password hashing?',
        ['bcrypt', 'Base64 encoding', 'Plaintext storage', 'URL encoding'],
        'bcrypt is a salted, work-factor-based password hashing scheme.',
      ),
      multiple(
        'Select the goals in the CIA security triad.',
        ['Confidentiality', 'Integrity', 'Availability', 'Animation'],
        [0, 1, 2],
        'CIA stands for confidentiality, integrity and availability.',
      ),
      boolean(
        'A cryptographic hash is encryption that can be reversed using a decryption key.',
        false,
        'A hash is a one-way digest, not reversible encryption.',
      ),
    ],
  ],
  [
    'CLOUD',
    'Cloud Computing',
    'cloud-services',
    [
      single(
        'What does elasticity describe in cloud computing?',
        [
          'Adjusting resources to changing demand',
          'Disabling all scaling',
          'Keeping only one local disk',
          'Removing authentication',
        ],
        'Elasticity increases or decreases resources as demand changes.',
      ),
      multiple(
        'Select common cloud service models.',
        ['IaaS', 'PaaS', 'SaaS', 'TCP'],
        [0, 1, 2],
        'IaaS, PaaS and SaaS describe service delivery models; TCP is a transport protocol.',
      ),
      boolean(
        'Database replication alone replaces a backup capable of recovering from an accidental deletion.',
        false,
        'A deletion may replicate, so recoverable backups are still needed.',
      ),
    ],
  ],
  [
    'CG',
    'Computer Graphics',
    'graphics-basics',
    [
      single(
        'What is the basic picture element in a raster image?',
        ['Pixel', 'SQL row', 'Network port', 'Compiler token'],
        'A raster image stores a grid of pixels.',
      ),
      multiple(
        'Select geometric transformations.',
        ['Translation', 'Rotation', 'Encryption', 'Lossless compression'],
        [0, 1],
        'Translation and rotation change geometric position or orientation.',
      ),
      boolean(
        'RGB is an additive colour model.',
        true,
        'Red, green and blue light combine additively in the RGB model.',
      ),
    ],
  ],
].map(([code, name, topic, questions]) => ({ code, name, topic, questions }));

export const cseStudentNames = [
  'Aarav Kumar',
  'Aditi Sharma',
  'Arjun Nair',
  'Ananya Iyer',
  'Aditya Rao',
  'Diya Menon',
  'Dhruv Shah',
  'Ishita Patel',
  'Karthik Reddy',
  'Kavya Das',
  'Manav Joshi',
  'Meera Pillai',
  'Nikhil Verma',
  'Nitya Sen',
  'Pranav Gupta',
  'Riya Bose',
  'Rohan Mehta',
  'Sana Khan',
  'Varun Kapoor',
  'Zoya Ali',
];
