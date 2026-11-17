using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => { o.Limits.MaxRequestBodySize = 16 * 1024; o.AddServerHeader = false; });
builder.Services.AddResponseCompression(o => o.EnableForHttps = true);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Behind a reverse proxy, set ASPNETCORE_FORWARDEDHEADERS_ENABLED=true so this sees the visitor's IP, not the proxy's.
    o.AddPolicy("contact", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromHours(1) }));
});

var app = builder.Build();

// Content lives in one file and is checked at boot, so a typo fails the deploy instead of a visitor.
var portfolio = JsonSerializer.Deserialize<Portfolio>(
    File.ReadAllText(Path.Combine(app.Environment.ContentRootPath, "portfolio.json")),
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true })
    ?? throw new InvalidOperationException("portfolio.json is empty.");
if (portfolio.Stations.Length != 7)
    throw new InvalidOperationException("portfolio.json needs exactly 7 stations, one per turn of the track.");

var dbPath = Path.GetFullPath(app.Configuration["DB_PATH"] ?? "data/portfolio.db");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
var connStr = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
using (var db = Open())
{
    var cmd = db.CreateCommand();
    cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS ContactMessage (
            Id INTEGER PRIMARY KEY,
            Name TEXT NOT NULL,
            Email TEXT NOT NULL,
            Message TEXT NOT NULL,
            CreatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))
        """;
    cmd.ExecuteNonQuery();
}

app.Use((ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h.ContentSecurityPolicy = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
        "img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    return next();
});
app.UseResponseCompression();
app.UseRateLimiter();

// The built React app is copied into wwwroot by the Dockerfile. Vite's /assets files are content-hashed, so they cache forever.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c =>
    {
        if (c.Context.Request.Path.StartsWithSegments("/assets"))
            c.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
    }
});

app.MapGet("/api/health", () => new { ok = true });

app.MapGet("/api/portfolio", (HttpResponse res) =>
{
    res.Headers.CacheControl = "public,max-age=300";
    return portfolio;
});

app.MapPost("/api/contact", (ContactRequest req) =>
{
    var errors = new List<ValidationResult>();
    if (!Validator.TryValidateObject(req, new ValidationContext(req), errors, validateAllProperties: true))
        return Results.ValidationProblem(errors
            .GroupBy(e => e.MemberNames.FirstOrDefault() ?? "")
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage ?? "Invalid.").ToArray()));
    // Honeypot: the field is hidden from people, so only bots fill it. Answer as if it worked.
    if (!string.IsNullOrEmpty(req.Website)) return Results.Accepted();
    using var db = Open();
    var cmd = db.CreateCommand();
    cmd.CommandText = "INSERT INTO ContactMessage (Name, Email, Message) VALUES ($name, $email, $message)";
    cmd.Parameters.AddWithValue("$name", req.Name.Trim());
    cmd.Parameters.AddWithValue("$email", req.Email.Trim());
    cmd.Parameters.AddWithValue("$message", req.Message.Trim());
    cmd.ExecuteNonQuery();
    return Results.Accepted();
}).RequireRateLimiting("contact");

// Owner's inbox: curl -H "X-Admin-Key: ..." /api/contact. Off (404) unless ADMIN_KEY is set.
app.MapGet("/api/contact", (HttpRequest http) =>
{
    var key = app.Configuration["ADMIN_KEY"];
    var given = http.Headers["X-Admin-Key"].ToString();
    if (string.IsNullOrEmpty(key) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(given)))
        return Results.NotFound();
    using var db = Open();
    var cmd = db.CreateCommand();
    cmd.CommandText = "SELECT Id, Name, Email, Message, CreatedAt FROM ContactMessage ORDER BY Id DESC LIMIT 200";
    using var r = cmd.ExecuteReader();
    var rows = new List<ContactMessage>();
    while (r.Read()) rows.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4)));
    return Results.Ok(rows);
});

app.MapFallback("/api/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

SqliteConnection Open()
{
    var c = new SqliteConnection(connStr);
    c.Open();
    return c;
}

record Portfolio(string Name, string Role, string HeroSub, Station[] Stations);
record Station(int Turn, string Short, string Title, string Sub, string Body,
    string[]? Chips = null, Job[]? Roles = null, Project[]? Projects = null, Step[]? Steps = null, Link[]? Links = null);
record Job(string Role, string Company, string Years, string Text);
record Project(string Name, string Text, string[] Stack, string? Url = null);
record Step(string Title, string Text);
record Link(string Label, string Href);

record ContactRequest(
    [property: Required, StringLength(80)] string Name,
    [property: Required, EmailAddress, StringLength(254)] string Email,
    [property: Required, StringLength(4000, MinimumLength = 10)] string Message,
    string? Website);
record ContactMessage(long Id, string Name, string Email, string Message, string CreatedAt);
