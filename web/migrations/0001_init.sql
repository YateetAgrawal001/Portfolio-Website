-- Same table as the ASP.NET Core API creates in SQLite (api/Program.cs).
CREATE TABLE IF NOT EXISTS ContactMessage (
    Id INTEGER PRIMARY KEY,
    Name TEXT NOT NULL,
    Email TEXT NOT NULL,
    Message TEXT NOT NULL,
    CreatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));

-- Contact posts per visitor IP per hour. One row per IP and hour, old hours are deleted as new posts arrive.
CREATE TABLE IF NOT EXISTS RateLimit (
    Ip TEXT NOT NULL,
    Hour INTEGER NOT NULL,
    Count INTEGER NOT NULL,
    PRIMARY KEY (Ip, Hour)) WITHOUT ROWID;
