# End-to-end check against a freshly started instance:  .\smoke.ps1  [-Base http://localhost:8080]
# Run it once per start: the contact endpoint allows 5 posts per hour per IP, and this script uses them up on purpose.
param([string]$Base = 'http://localhost:8080')

$failed = 0
function Check($name, $ok) {
    if ($ok) { "ok    $name" } else { "FAIL  $name"; $script:failed++ }
}
function Post($json) {
    $json | curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary '@-' "$Base/api/contact"
}
function Status($path) { curl.exe -s -o NUL -w '%{http_code}' "$Base$path" }

Check 'health'                        ((curl.exe -s "$Base/api/health") -match '"ok":true')
Check 'portfolio has 7 stations'      ((curl.exe -s "$Base/api/portfolio" | ConvertFrom-Json).stations.Count -eq 7)
Check 'unknown api route is 404'      ((Status '/api/nope') -eq '404')
Check 'inbox is closed without a key' ((Status '/api/contact') -eq '404')
Check 'short message rejected'        ((Post '{"name":"A","email":"a@b.co","message":"short"}') -eq '400')
Check 'bad email rejected'            ((Post '{"name":"A","email":"nope","message":"long enough message"}') -eq '400')
Check 'missing name rejected'         ((Post '{"email":"a@b.co","message":"long enough message"}') -eq '400')
Check 'valid message accepted'        ((Post '{"name":"Smoke","email":"smoke@example.com","message":"Smoke test message."}') -eq '202')
Check 'honeypot accepted quietly'     ((Post '{"name":"Bot","email":"bot@example.com","message":"I am a bot, hello.","website":"http://spam"}') -eq '202')
Check 'sixth post is rate limited'    ((Post '{"name":"Smoke","email":"smoke@example.com","message":"One message too many."}') -eq '429')

if ($failed) { "$failed check(s) failed"; exit 1 } else { 'all checks passed' }
