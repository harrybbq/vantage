/**
 * The practice curriculum — actual problems to work through, not just a
 * log of whatever you happened to do.
 *
 * ── Where these come from, and why not an API ────────────────────────
 *
 * LeetCode has no official public API. The unofficial GraphQL endpoint
 * is CORS-blocked from a browser, rate-limited, and changes without
 * notice — this session has already spent hours on one integration
 * breaking exactly that way. So the list is bundled: it works offline,
 * costs nothing, and cannot rot.
 *
 * What is bundled is METADATA ONLY — title, difficulty, topic, pattern,
 * and the slug that builds the URL. No problem statements: those are
 * LeetCode's copyrighted text, and reproducing them here would be
 * lifting their content rather than pointing at it. "Start" opens the
 * real page.
 *
 * KQL has no equivalent problem bank at all, so the exercises below are
 * written from scratch against the tables actually used in a Microsoft
 * security stack. They carry a full scenario, a hint and a reference
 * solution, because there is nowhere to send you to read them.
 *
 * Pure data + pure selectors. No DOM, no React, no network.
 */

/* ══════════════════════════════════════════════════════════════════════
   LeetCode — the Blind 75. A finite, well-known list with broad pattern
   coverage; finite matters, because a curriculum you can finish is one
   you can measure progress against.
   ══════════════════════════════════════════════════════════════════ */

const LC = (slug, title, difficulty, topic, pattern) => ({
  id: 'lc:' + slug, kind: 'leetcode', slug, title, difficulty, topic, pattern,
  url: `https://leetcode.com/problems/${slug}/`,
});

export const LEETCODE = [
  // Arrays & hashing
  LC('two-sum', 'Two Sum', 'Easy', 'Arrays', 'Hash map'),
  LC('contains-duplicate', 'Contains Duplicate', 'Easy', 'Arrays', 'Hash set'),
  LC('best-time-to-buy-and-sell-stock', 'Best Time to Buy and Sell Stock', 'Easy', 'Arrays', 'Running min'),
  LC('product-of-array-except-self', 'Product of Array Except Self', 'Medium', 'Arrays', 'Prefix/suffix'),
  LC('maximum-subarray', 'Maximum Subarray', 'Medium', 'Arrays', 'Kadane'),
  LC('maximum-product-subarray', 'Maximum Product Subarray', 'Medium', 'Arrays', 'Kadane variant'),
  LC('find-minimum-in-rotated-sorted-array', 'Find Minimum in Rotated Sorted Array', 'Medium', 'Binary search', 'Rotated array'),
  LC('search-in-rotated-sorted-array', 'Search in Rotated Sorted Array', 'Medium', 'Binary search', 'Rotated array'),
  LC('3sum', '3Sum', 'Medium', 'Arrays', 'Two pointers'),
  LC('container-with-most-water', 'Container With Most Water', 'Medium', 'Arrays', 'Two pointers'),

  // Binary
  LC('sum-of-two-integers', 'Sum of Two Integers', 'Medium', 'Bit manipulation', 'Bitwise add'),
  LC('number-of-1-bits', 'Number of 1 Bits', 'Easy', 'Bit manipulation', 'Popcount'),
  LC('counting-bits', 'Counting Bits', 'Easy', 'Bit manipulation', 'DP on bits'),
  LC('missing-number', 'Missing Number', 'Easy', 'Bit manipulation', 'XOR / sum'),
  LC('reverse-bits', 'Reverse Bits', 'Easy', 'Bit manipulation', 'Bit shifting'),

  // Dynamic programming
  LC('climbing-stairs', 'Climbing Stairs', 'Easy', 'DP', 'Fibonacci'),
  LC('coin-change', 'Coin Change', 'Medium', 'DP', 'Unbounded knapsack'),
  LC('longest-increasing-subsequence', 'Longest Increasing Subsequence', 'Medium', 'DP', 'LIS'),
  LC('longest-common-subsequence', 'Longest Common Subsequence', 'Medium', 'DP', '2D grid'),
  LC('word-break', 'Word Break', 'Medium', 'DP', 'Partition'),
  LC('combination-sum-iv', 'Combination Sum IV', 'Medium', 'DP', 'Counting'),
  LC('house-robber', 'House Robber', 'Medium', 'DP', 'Linear'),
  LC('house-robber-ii', 'House Robber II', 'Medium', 'DP', 'Circular'),
  LC('decode-ways', 'Decode Ways', 'Medium', 'DP', 'String partition'),
  LC('unique-paths', 'Unique Paths', 'Medium', 'DP', 'Grid'),
  LC('jump-game', 'Jump Game', 'Medium', 'Greedy', 'Reachability'),

  // Graphs
  LC('clone-graph', 'Clone Graph', 'Medium', 'Graphs', 'DFS + map'),
  LC('course-schedule', 'Course Schedule', 'Medium', 'Graphs', 'Topological sort'),
  LC('pacific-atlantic-water-flow', 'Pacific Atlantic Water Flow', 'Medium', 'Graphs', 'Multi-source DFS'),
  LC('number-of-islands', 'Number of Islands', 'Medium', 'Graphs', 'Flood fill'),
  LC('longest-consecutive-sequence', 'Longest Consecutive Sequence', 'Medium', 'Arrays', 'Hash set'),
  LC('alien-dictionary', 'Alien Dictionary', 'Hard', 'Graphs', 'Topological sort'),
  LC('graph-valid-tree', 'Graph Valid Tree', 'Medium', 'Graphs', 'Union find'),
  LC('number-of-connected-components-in-an-undirected-graph', 'Connected Components in an Undirected Graph', 'Medium', 'Graphs', 'Union find'),

  // Intervals
  LC('insert-interval', 'Insert Interval', 'Medium', 'Intervals', 'Merge'),
  LC('merge-intervals', 'Merge Intervals', 'Medium', 'Intervals', 'Sort + merge'),
  LC('non-overlapping-intervals', 'Non-overlapping Intervals', 'Medium', 'Intervals', 'Greedy'),
  LC('meeting-rooms', 'Meeting Rooms', 'Easy', 'Intervals', 'Sort'),
  LC('meeting-rooms-ii', 'Meeting Rooms II', 'Medium', 'Intervals', 'Heap'),

  // Linked lists
  LC('reverse-linked-list', 'Reverse Linked List', 'Easy', 'Linked lists', 'Pointer reversal'),
  LC('linked-list-cycle', 'Linked List Cycle', 'Easy', 'Linked lists', "Floyd's"),
  LC('merge-two-sorted-lists', 'Merge Two Sorted Lists', 'Easy', 'Linked lists', 'Two pointers'),
  LC('merge-k-sorted-lists', 'Merge k Sorted Lists', 'Hard', 'Heap', 'k-way merge'),
  LC('remove-nth-node-from-end-of-list', 'Remove Nth Node From End of List', 'Medium', 'Linked lists', 'Two pointers'),
  LC('reorder-list', 'Reorder List', 'Medium', 'Linked lists', 'Split + reverse'),

  // Matrix
  LC('set-matrix-zeroes', 'Set Matrix Zeroes', 'Medium', 'Matrix', 'In-place marking'),
  LC('spiral-matrix', 'Spiral Matrix', 'Medium', 'Matrix', 'Boundary walk'),
  LC('rotate-image', 'Rotate Image', 'Medium', 'Matrix', 'Transpose + flip'),
  LC('word-search', 'Word Search', 'Medium', 'Backtracking', 'Grid DFS'),

  // Strings
  LC('longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters', 'Medium', 'Strings', 'Sliding window'),
  LC('longest-repeating-character-replacement', 'Longest Repeating Character Replacement', 'Medium', 'Strings', 'Sliding window'),
  LC('minimum-window-substring', 'Minimum Window Substring', 'Hard', 'Strings', 'Sliding window'),
  LC('valid-anagram', 'Valid Anagram', 'Easy', 'Strings', 'Counting'),
  LC('group-anagrams', 'Group Anagrams', 'Medium', 'Strings', 'Hash map'),
  LC('valid-parentheses', 'Valid Parentheses', 'Easy', 'Stack', 'Matching'),
  LC('valid-palindrome', 'Valid Palindrome', 'Easy', 'Strings', 'Two pointers'),
  LC('longest-palindromic-substring', 'Longest Palindromic Substring', 'Medium', 'Strings', 'Expand from centre'),
  LC('palindromic-substrings', 'Palindromic Substrings', 'Medium', 'Strings', 'Expand from centre'),
  LC('encode-and-decode-strings', 'Encode and Decode Strings', 'Medium', 'Strings', 'Length prefix'),

  // Trees
  LC('maximum-depth-of-binary-tree', 'Maximum Depth of Binary Tree', 'Easy', 'Trees', 'DFS'),
  LC('same-tree', 'Same Tree', 'Easy', 'Trees', 'DFS'),
  LC('invert-binary-tree', 'Invert Binary Tree', 'Easy', 'Trees', 'DFS'),
  LC('binary-tree-maximum-path-sum', 'Binary Tree Maximum Path Sum', 'Hard', 'Trees', 'DFS with return'),
  LC('binary-tree-level-order-traversal', 'Binary Tree Level Order Traversal', 'Medium', 'Trees', 'BFS'),
  LC('serialize-and-deserialize-binary-tree', 'Serialize and Deserialize Binary Tree', 'Hard', 'Trees', 'Preorder + null markers'),
  LC('subtree-of-another-tree', 'Subtree of Another Tree', 'Easy', 'Trees', 'DFS'),
  LC('construct-binary-tree-from-preorder-and-inorder-traversal', 'Construct Binary Tree from Preorder and Inorder', 'Medium', 'Trees', 'Divide and conquer'),
  LC('validate-binary-search-tree', 'Validate Binary Search Tree', 'Medium', 'Trees', 'Bounds'),
  LC('kth-smallest-element-in-a-bst', 'Kth Smallest Element in a BST', 'Medium', 'Trees', 'Inorder'),
  LC('lowest-common-ancestor-of-a-binary-search-tree', 'Lowest Common Ancestor of a BST', 'Medium', 'Trees', 'BST property'),
  LC('implement-trie-prefix-tree', 'Implement Trie (Prefix Tree)', 'Medium', 'Tries', 'Trie'),
  LC('design-add-and-search-words-data-structure', 'Design Add and Search Words Data Structure', 'Medium', 'Tries', 'Trie + wildcard'),
  LC('word-search-ii', 'Word Search II', 'Hard', 'Tries', 'Trie + grid DFS'),

  // Heap
  LC('top-k-frequent-elements', 'Top K Frequent Elements', 'Medium', 'Heap', 'Bucket sort'),
  LC('find-median-from-data-stream', 'Find Median from Data Stream', 'Hard', 'Heap', 'Two heaps'),
];

/* ══════════════════════════════════════════════════════════════════════
   KQL — written here, because no public problem bank exists.

   Scenarios use the real tables of a Microsoft security stack
   (SigninLogs, DeviceProcessEvents, DeviceNetworkEvents, SecurityAlert,
   AuditLogs) so practice transfers directly to the job rather than to a
   toy schema. Each carries a hint and a reference solution; `solution`
   is one correct answer, not the only one.
   ══════════════════════════════════════════════════════════════════ */

const KQ = (id, title, difficulty, topic, tables, prompt, hint, solution) => ({
  id: 'kql:' + id, kind: 'kql', slug: id, title, difficulty, topic,
  pattern: topic, tables, prompt, hint, solution,
});

export const KQL = [
  KQ('failed-signins-by-ip', 'Brute force by IP', 'Easy', 'summarize',
    ['SigninLogs'],
    'Find every IP address with more than 10 failed sign-ins in the last 24 hours. Show the IP, how many attempts, and how many distinct accounts it went after — the account count is what separates a user who forgot their password from someone spraying.',
    'ResultType != 0 marks a failure. dcount() gives distinct accounts.',
    `SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != 0
| summarize attempts = count(),
            accounts = dcount(UserPrincipalName)
          by IPAddress
| where attempts > 10
| order by attempts desc`),

  KQ('successful-after-failures', 'Success after a burst of failures', 'Medium', 'join',
    ['SigninLogs'],
    'Find accounts that failed to sign in at least 5 times and then succeeded, from the same IP, within an hour. This is the shape of a brute force that worked.',
    'Summarise failures and successes separately, then join on the account and IP. Compare the timestamps afterwards.',
    `let failures = SigninLogs
  | where TimeGenerated > ago(7d) and ResultType != 0
  | summarize fails = count(), lastFail = max(TimeGenerated)
            by UserPrincipalName, IPAddress
  | where fails >= 5;
let wins = SigninLogs
  | where TimeGenerated > ago(7d) and ResultType == 0
  | summarize firstWin = min(TimeGenerated) by UserPrincipalName, IPAddress;
failures
| join kind=inner wins on UserPrincipalName, IPAddress
| where firstWin between (lastFail .. lastFail + 1h)
| project UserPrincipalName, IPAddress, fails, lastFail, firstWin`),

  KQ('impossible-travel', 'Impossible travel', 'Hard', 'window functions',
    ['SigninLogs'],
    'For each account, find consecutive successful sign-ins from two different countries less than two hours apart. Show both countries and the gap.',
    'Sort by account and time, then prev() to reach the previous row. Guard that the previous row belongs to the same account.',
    `SigninLogs
| where TimeGenerated > ago(7d) and ResultType == 0
| project TimeGenerated, UserPrincipalName,
          Country = tostring(LocationDetails.countryOrRegion)
| order by UserPrincipalName asc, TimeGenerated asc
| extend prevUser = prev(UserPrincipalName),
         prevCountry = prev(Country),
         prevTime = prev(TimeGenerated)
| where prevUser == UserPrincipalName and prevCountry != Country
| extend gap = TimeGenerated - prevTime
| where gap < 2h
| project UserPrincipalName, prevCountry, Country, prevTime, TimeGenerated, gap`),

  KQ('rare-parent-child', 'Rare parent/child process pairs', 'Medium', 'summarize',
    ['DeviceProcessEvents'],
    'Office applications spawning shells is a classic execution signal. Find every process started by winword.exe, excel.exe or outlook.exe in the last 7 days, and rank the pairs by how rare they are across the estate.',
    'Summarise by the pair, then use dcount of devices to judge rarity — something on one machine is more interesting than something on four hundred.',
    `DeviceProcessEvents
| where Timestamp > ago(7d)
| where InitiatingProcessFileName in~ ("winword.exe", "excel.exe", "outlook.exe")
| summarize runs = count(),
            devices = dcount(DeviceName),
            sample = any(ProcessCommandLine)
          by InitiatingProcessFileName, FileName
| order by devices asc, runs asc`),

  KQ('beaconing', 'Beaconing to a single destination', 'Hard', 'bin / time series',
    ['DeviceNetworkEvents'],
    'Find devices talking to the same remote address on a very regular cadence — the signature of a beacon. Bucket connections into 5-minute bins and look for a low spread in the gaps between them.',
    'Bin the timestamps, take the gaps with prev(), then compare stdev to avg. A near-zero ratio means clockwork.',
    `DeviceNetworkEvents
| where Timestamp > ago(3d) and isnotempty(RemoteIP)
| summarize by DeviceName, RemoteIP, bin(Timestamp, 5m)
| order by DeviceName asc, RemoteIP asc, Timestamp asc
| extend prevT = prev(Timestamp), prevIP = prev(RemoteIP), prevDev = prev(DeviceName)
| where prevDev == DeviceName and prevIP == RemoteIP
| extend gapMin = datetime_diff('minute', Timestamp, prevT)
| summarize beats = count(), avgGap = avg(gapMin), spread = stdev(gapMin)
          by DeviceName, RemoteIP
| where beats > 12 and spread / avgGap < 0.1
| order by beats desc`),

  KQ('mv-expand-alerts', 'Unpack alert entities', 'Medium', 'mv-expand',
    ['SecurityAlert'],
    'SecurityAlert stores its entities as a JSON array in one column. Produce one row per account entity, with the alert name and severity alongside it.',
    'parse_json() first, then mv-expand to turn the array into rows. Filter on the entity Type after expanding.',
    `SecurityAlert
| where TimeGenerated > ago(7d)
| extend entities = parse_json(Entities)
| mv-expand entity = entities
| where tostring(entity.Type) == "account"
| project TimeGenerated, AlertName, AlertSeverity,
          Account = strcat(tostring(entity.NTDomain), "\\\\", tostring(entity.Name))
| order by TimeGenerated desc`),

  KQ('let-watchlist', 'Match against a watchlist', 'Easy', 'let',
    ['SigninLogs'],
    'You have a handful of high-value accounts. Show every sign-in by those accounts from outside the UK, without repeating the account list three times in the query.',
    'A let with a dynamic array, then the in~ operator.',
    `let vips = dynamic(["ceo@corp.com", "cfo@corp.com", "admin@corp.com"]);
SigninLogs
| where TimeGenerated > ago(30d)
| where UserPrincipalName in~ (vips)
| where tostring(LocationDetails.countryOrRegion) != "GB"
| project TimeGenerated, UserPrincipalName,
          Country = tostring(LocationDetails.countryOrRegion),
          IPAddress, ResultType`),

  KQ('parse-cmdline', 'Pull an argument out of a command line', 'Medium', 'parse',
    ['DeviceProcessEvents'],
    'Find PowerShell processes launched with an encoded command, and extract the base64 payload into its own column so it can be decoded.',
    'parse with a wildcard, or extract() with a regex. Remember -enc, -encodedcommand and -e are all the same flag.',
    `DeviceProcessEvents
| where Timestamp > ago(7d)
| where FileName =~ "powershell.exe"
| where ProcessCommandLine has_any ("-enc", "-encodedcommand", "-e ")
| extend payload = extract(@"(?i)-e(?:nc|ncodedcommand)?\\s+([A-Za-z0-9+/=]{20,})", 1, ProcessCommandLine)
| where isnotempty(payload)
| extend decoded = base64_decode_tostring(payload)
| project Timestamp, DeviceName, AccountName, decoded, ProcessCommandLine`),

  KQ('first-seen', 'First time this device did this', 'Medium', 'summarize',
    ['DeviceProcessEvents'],
    'New behaviour is more interesting than frequent behaviour. For a given binary, show devices that ran it for the first time in the last 24 hours but never in the 30 days before.',
    'Build a set of "seen before" pairs and anti-join against it. leftanti is the operator.',
    `let historical = DeviceProcessEvents
  | where Timestamp between (ago(30d) .. ago(24h))
  | distinct DeviceName, FileName;
DeviceProcessEvents
| where Timestamp > ago(24h)
| distinct DeviceName, FileName
| join kind=leftanti historical on DeviceName, FileName
| order by DeviceName asc`),

  KQ('time-chart-signins', 'Sign-in failures over time', 'Easy', 'bin / time series',
    ['SigninLogs'],
    'Chart failed sign-ins per hour over the last 3 days, split by whether the failure was a bad password or a blocked conditional access policy.',
    'bin() the timestamp, use case() to bucket the ResultType, then render a timechart.',
    `SigninLogs
| where TimeGenerated > ago(3d) and ResultType != 0
| extend reason = case(ResultType == 50126, "Bad password",
                       ResultType == 53003, "Blocked by CA",
                       "Other")
| summarize failures = count() by bin(TimeGenerated, 1h), reason
| render timechart`),

  KQ('dcount-anomaly', 'Accounts touching unusually many devices', 'Medium', 'summarize',
    ['DeviceLogonEvents'],
    'Find accounts that logged on to far more devices in the last day than they normally do. Compare the last 24 hours against a 14-day baseline.',
    'Two summaries and a join. Guard against dividing by zero when the baseline is empty.',
    `let baseline = DeviceLogonEvents
  | where Timestamp between (ago(14d) .. ago(1d))
  | summarize baseDevices = dcount(DeviceName) / 13.0 by AccountName;
DeviceLogonEvents
| where Timestamp > ago(1d)
| summarize todayDevices = dcount(DeviceName) by AccountName
| join kind=inner baseline on AccountName
| where baseDevices > 0 and todayDevices > baseDevices * 3
| project AccountName, todayDevices, baseDevices = round(baseDevices, 1)
| order by todayDevices desc`),

  KQ('externaldata-ioc', 'Match traffic against an IOC feed', 'Hard', 'externaldata',
    ['DeviceNetworkEvents'],
    'You have a plain-text list of malicious IPs at a URL, one per line. Pull it in and find any device that talked to one in the last 7 days.',
    'externaldata declares the schema of the remote file. Materialise it if you use it more than once.',
    `let iocs = materialize(
  externaldata(ip: string)
  [@"https://example.com/feeds/bad-ips.txt"]
  with (format="txt")
  | where isnotempty(ip) and not(ip startswith "#"));
DeviceNetworkEvents
| where Timestamp > ago(7d)
| where RemoteIP in (iocs)
| summarize hits = count(), firstSeen = min(Timestamp), lastSeen = max(Timestamp)
          by DeviceName, RemoteIP, InitiatingProcessFileName
| order by hits desc`),

  KQ('make-set-story', 'Build a per-incident story', 'Medium', 'make_set / make_list',
    ['SecurityAlert'],
    'For each account that triggered alerts this week, collapse them into one row: how many alerts, the distinct alert names, the worst severity, and the window they span.',
    'make_set() for the distinct names. Severity is a string, so map it to a number before taking a max.',
    `SecurityAlert
| where TimeGenerated > ago(7d)
| extend sev = case(AlertSeverity == "High", 3,
                    AlertSeverity == "Medium", 2,
                    AlertSeverity == "Low", 1, 0)
| summarize alerts = count(),
            names = make_set(AlertName, 10),
            worst = max(sev),
            firstSeen = min(TimeGenerated),
            lastSeen = max(TimeGenerated)
          by CompromisedEntity
| extend worstSeverity = case(worst == 3, "High", worst == 2, "Medium", worst == 1, "Low", "Informational")
| project CompromisedEntity, alerts, worstSeverity, names, firstSeen, lastSeen
| order by worst desc, alerts desc`),

  KQ('audit-role-changes', 'Privileged role changes', 'Easy', 'parse',
    ['AuditLogs'],
    'Show every addition to a privileged directory role in the last 30 days: who was added, to what role, and who did it.',
    'The role name and the target are both buried in TargetResources. mv-expand and modifiedProperties get you there.',
    `AuditLogs
| where TimeGenerated > ago(30d)
| where OperationName has "Add member to role"
| mv-expand target = TargetResources
| extend props = target.modifiedProperties
| mv-expand prop = props
| where tostring(prop.displayName) == "Role.DisplayName"
| project TimeGenerated,
          Role = trim('"', tostring(prop.newValue)),
          AddedUser = tostring(target.userPrincipalName),
          By = tostring(InitiatedBy.user.userPrincipalName)
| order by TimeGenerated desc`),

  KQ('union-across-tables', 'One timeline from several tables', 'Medium', 'union',
    ['DeviceProcessEvents', 'DeviceNetworkEvents', 'DeviceLogonEvents'],
    'Build a single chronological timeline for one device over the last 12 hours, combining process starts, network connections and logons into a common shape.',
    'union with a projected common schema. Give each source an Activity column so the rows stay distinguishable.',
    `let target = "LAPTOP-042";
union
  (DeviceProcessEvents
    | where Timestamp > ago(12h) and DeviceName == target
    | project Timestamp, Activity = "Process", Detail = ProcessCommandLine, Account = AccountName),
  (DeviceNetworkEvents
    | where Timestamp > ago(12h) and DeviceName == target
    | project Timestamp, Activity = "Network",
              Detail = strcat(RemoteIP, ":", tostring(RemotePort)), Account = InitiatingProcessAccountName),
  (DeviceLogonEvents
    | where Timestamp > ago(12h) and DeviceName == target
    | project Timestamp, Activity = "Logon", Detail = LogonType, Account = AccountName)
| order by Timestamp asc`),

  KQ('percentile-latency', 'Percentiles, not averages', 'Easy', 'summarize',
    ['SigninLogs'],
    'Averages hide the tail. Show the 50th, 95th and 99th percentile of sign-in processing time per application over the last day, plus the volume.',
    'percentiles() takes several at once and returns separate columns.',
    `SigninLogs
| where TimeGenerated > ago(1d) and isnotnull(ProcessingTimeInMilliseconds)
| summarize signins = count(),
            percentiles(ProcessingTimeInMilliseconds, 50, 95, 99)
          by AppDisplayName
| where signins > 100
| order by percentile_ProcessingTimeInMilliseconds_99 desc`),

  KQ('anomaly-detection', 'Spot a spike automatically', 'Hard', 'series functions',
    ['SigninLogs'],
    'Rather than eyeballing a chart, have KQL flag the spikes for you: build an hourly series of failed sign-ins per country over 14 days and mark anomalous points.',
    'make-series to get an even series, then series_decompose_anomalies. mv-expand to get back to rows.',
    `SigninLogs
| where TimeGenerated > ago(14d) and ResultType != 0
| extend Country = tostring(LocationDetails.countryOrRegion)
| make-series failures = count() default = 0
    on TimeGenerated from ago(14d) to now() step 1h
    by Country
| extend (anomalies, score, baseline) = series_decompose_anomalies(failures, 2.5)
| mv-expand TimeGenerated to typeof(datetime), failures to typeof(long),
            anomalies to typeof(int), score to typeof(double)
| where anomalies != 0
| project TimeGenerated, Country, failures, score
| order by score desc`),

  KQ('has-vs-contains', 'has, contains, and why it matters', 'Easy', 'operators',
    ['DeviceProcessEvents'],
    'Find command lines mentioning "mimikatz". Write it the fast way, and be able to say why the obvious way is slower.',
    'has is term-indexed; contains scans substrings. Case-insensitive by default for has; use has_cs when you mean it.',
    `// Fast — uses the term index
DeviceProcessEvents
| where Timestamp > ago(30d)
| where ProcessCommandLine has "mimikatz"
| project Timestamp, DeviceName, AccountName, ProcessCommandLine

// contains would also match "notmimikatzhere" but cannot use the
// index, so it scans every row. Only reach for it when you genuinely
// need a substring match inside a larger token.`),

  KQ('iff-and-coalesce', 'Fill in a missing column', 'Easy', 'operators',
    ['SigninLogs'],
    'Some sign-in rows have no UserPrincipalName but do have an AlternateSignInName. Produce one clean account column that prefers the UPN and falls back, and drop rows where neither exists.',
    'coalesce() takes the first non-empty. isnotempty() to filter afterwards.',
    `SigninLogs
| where TimeGenerated > ago(7d)
| extend Account = coalesce(UserPrincipalName, AlternateSignInName, Identity)
| where isnotempty(Account)
| summarize signins = count() by Account
| order by signins desc`),

  KQ('bin-vs-startofday', 'Daily counts that respect the boundary', 'Easy', 'bin / time series',
    ['SecurityAlert'],
    'Count alerts per day for the last 30 days by severity, aligned to real calendar days rather than to 24-hour blocks from now.',
    'startofday() anchors to midnight. bin(x, 1d) also lands on midnight for datetimes, but say which you meant.',
    `SecurityAlert
| where TimeGenerated > ago(30d)
| summarize alerts = count()
          by Day = startofday(TimeGenerated), AlertSeverity
| order by Day asc`),

  KQ('top-nested', 'Top N within each group', 'Medium', 'top-nested',
    ['DeviceNetworkEvents'],
    'For each of the five busiest devices, show its three most-contacted remote addresses. One query, no manual repetition.',
    'top-nested does grouped top-N in a single pass.',
    `DeviceNetworkEvents
| where Timestamp > ago(1d)
| top-nested 5 of DeviceName by conns = count(),
  top-nested 3 of RemoteIP by ipConns = count()
| project DeviceName, conns, RemoteIP, ipConns
| order by conns desc, ipConns desc`),

  KQ('materialize-reuse', 'Stop recomputing the same subquery', 'Medium', 'performance',
    ['DeviceProcessEvents'],
    'A query uses the same expensive subquery twice — once to find the busiest devices and once to filter events to them. Make it compute once.',
    'materialize() caches the result for the lifetime of the query. It only helps when the let is used more than once.',
    `let busy = materialize(
  DeviceProcessEvents
  | where Timestamp > ago(1d)
  | summarize runs = count() by DeviceName
  | top 20 by runs desc);
DeviceProcessEvents
| where Timestamp > ago(1d)
| where DeviceName in ((busy | project DeviceName))
| summarize events = count() by DeviceName, FileName
| join kind=inner busy on DeviceName
| project DeviceName, FileName, events, deviceTotal = runs
| order by deviceTotal desc, events desc`),

  KQ('lookback-join-window', 'Did the alert follow the download?', 'Hard', 'join',
    ['DeviceFileEvents', 'SecurityAlert'],
    'For each high-severity alert, find any file downloaded onto the same device in the 30 minutes before it fired.',
    'Join on the device, then filter on the time difference. Joining on a time range directly is not something KQL does for you.',
    `let alerts = SecurityAlert
  | where TimeGenerated > ago(7d) and AlertSeverity == "High"
  | extend DeviceName = tostring(parse_json(ExtendedProperties)["Device Name"])
  | where isnotempty(DeviceName)
  | project AlertTime = TimeGenerated, AlertName, DeviceName;
DeviceFileEvents
| where Timestamp > ago(7d) and ActionType == "FileCreated"
| where isnotempty(FileOriginUrl)
| join kind=inner alerts on DeviceName
| where Timestamp between (AlertTime - 30m .. AlertTime)
| project DeviceName, AlertName, AlertTime, Downloaded = Timestamp, FileName, FileOriginUrl
| order by AlertTime desc`),

  KQ('case-vs-iff', 'Bucket a numeric column', 'Easy', 'operators',
    ['DeviceNetworkEvents'],
    'Group outbound connections into port classes — web, mail, remote access, other — and count each. Do it without a chain of nested iff().',
    'case() takes pairs of condition and value, with a final default. Cleaner than nesting iff three deep.',
    `DeviceNetworkEvents
| where Timestamp > ago(1d) and ActionType == "ConnectionSuccess"
| extend class = case(RemotePort in (80, 443, 8080), "Web",
                      RemotePort in (25, 465, 587, 993), "Mail",
                      RemotePort in (22, 3389, 5900), "Remote access",
                      "Other")
| summarize conns = count(), devices = dcount(DeviceName) by class
| order by conns desc`),
];

export const ALL_PROBLEMS = [...LEETCODE, ...KQL];
export const problemById = id => ALL_PROBLEMS.find(p => p.id === id) || null;

/* ══════════════════════════════════════════════════════════════════════
   Progress
   ══════════════════════════════════════════════════════════════════ */

export const STATUSES = ['todo', 'attempted', 'solved'];

/** Confidence at or below this means it is not really learnt yet. */
export const SHAKY = 2;

/**
 * Days before a solved problem is worth seeing again. Longer the more
 * confident you were — the point of spacing is to revisit the weak
 * things often and the solid things rarely, not everything equally.
 */
export const REVIEW_AFTER_DAYS = { 3: 10, 4: 30, 5: 90 };

const DAY = 86400000;
const daysSince = iso => (iso ? Math.floor((Date.now() - new Date(iso + 'T12:00').getTime()) / DAY) : null);

/** Progress row for a problem, with defaults for one never touched. */
export function progressOf(S, id) {
  const p = (S && S.practice && S.practice.progress) || {};
  return p[id] || { status: 'todo', confidence: 0, attempts: 0, lastAt: null, notes: '' };
}

/**
 * Is this due for review? Solved-but-shaky is always due; solved-and-
 * confident comes back on the schedule above. Anything attempted but
 * not solved is due immediately — that is unfinished, not spaced.
 */
export function isDue(pr) {
  if (pr.status === 'todo') return false;
  if (pr.status === 'attempted') return true;
  if (pr.confidence <= SHAKY) return true;
  const days = daysSince(pr.lastAt);
  if (days == null) return true;
  return days >= (REVIEW_AFTER_DAYS[pr.confidence] || 30);
}

/** Per-kind counts, plus per-topic breakdown for the progress bars. */
export function summarise(S, kind) {
  const problems = ALL_PROBLEMS.filter(p => p.kind === kind);
  const byTopic = {};
  let solved = 0, attempted = 0, due = 0, shaky = 0;
  for (const p of problems) {
    const pr = progressOf(S, p.id);
    const t = (byTopic[p.topic] = byTopic[p.topic] || { topic: p.topic, total: 0, solved: 0, shaky: 0 });
    t.total++;
    if (pr.status === 'solved') { solved++; t.solved++; }
    else if (pr.status === 'attempted') attempted++;
    if (pr.status !== 'todo' && pr.confidence > 0 && pr.confidence <= SHAKY) { shaky++; t.shaky++; }
    if (isDue(pr)) due++;
  }
  return {
    total: problems.length, solved, attempted, due, shaky,
    todo: problems.length - solved - attempted,
    pct: problems.length ? Math.round((solved / problems.length) * 100) : 0,
    topics: Object.values(byTopic).sort((a, b) => a.topic.localeCompare(b.topic)),
  };
}

/**
 * What to do next.
 *
 * Order matters and is the opinion of the whole feature: finish what you
 * started, then repair what you got wrong, then work the weakest topic,
 * and only then start something new. A queue that just hands out the
 * next unsolved problem is a list, not a curriculum.
 */
export function nextUp(S, kind, limit = 3) {
  const problems = ALL_PROBLEMS.filter(p => p.kind === kind);
  const rows = problems.map(p => ({ p, pr: progressOf(S, p.id) }));

  const unfinished = rows.filter(r => r.pr.status === 'attempted');
  const forReview = rows.filter(r => r.pr.status === 'solved' && isDue(r.pr))
    .sort((a, b) => a.pr.confidence - b.pr.confidence);

  // Weakest topic = lowest solved share, ties broken by most shaky.
  const stats = summarise(S, kind);
  const weakest = [...stats.topics]
    .filter(t => t.solved < t.total)
    .sort((a, b) => (a.solved / a.total) - (b.solved / b.total) || b.shaky - a.shaky)[0];

  const fresh = rows
    .filter(r => r.pr.status === 'todo')
    .sort((a, b) => {
      const aw = weakest && a.p.topic === weakest.topic ? 0 : 1;
      const bw = weakest && b.p.topic === weakest.topic ? 0 : 1;
      if (aw !== bw) return aw - bw;
      const order = { Easy: 0, Medium: 1, Hard: 2 };
      return (order[a.p.difficulty] ?? 1) - (order[b.p.difficulty] ?? 1);
    });

  const picked = [];
  const push = (r, why) => {
    if (picked.length >= limit || picked.some(x => x.p.id === r.p.id)) return;
    picked.push({ ...r, why });
  };
  unfinished.forEach(r => push(r, 'Started, not finished'));
  forReview.forEach(r => push(r, r.pr.confidence <= SHAKY ? 'Marked shaky' : 'Due for review'));
  fresh.forEach(r => push(r, weakest && r.p.topic === weakest.topic ? `Weakest topic — ${weakest.topic}` : 'Next in the set'));
  return picked;
}
