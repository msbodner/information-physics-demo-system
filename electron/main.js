const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const net = require("net");
const http = require("http");
const fs = require("fs");
const treeKill = require("tree-kill");

// ── Configuration ────────────────────────────────────────────────
const APP_NAME = "AIO System App";
const isDev = !app.isPackaged;

// Resource paths differ between dev and packaged app
function resourcePath(sub) {
  if (isDev) {
    return path.join(__dirname, "resources", sub);
  }
  return path.join(process.resourcesPath, sub);
}

// User data directory for persistent storage
const userData = app.getPath("userData");
const pgDataDir = path.join(userData, "pgdata");
const logsDir = path.join(userData, "logs");

// ── State ────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let pgProcess = null;
let backendProcess = null;
let frontendProcess = null;
let ports = { pg: 5433, backend: 9080, frontend: 3100 };

// ── Port Finding ─────────────────────────────────────────────────
function findPort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      // Port taken, try next
      resolve(findPort(startPort + 1));
    });
  });
}

async function findPorts() {
  ports.pg = await findPort(5433);
  ports.backend = await findPort(9080);
  ports.frontend = await findPort(3100);
  log(`Ports: PG=${ports.pg}, Backend=${ports.backend}, Frontend=${ports.frontend}`);
}

// ── Logging ──────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "app.log"), line + "\n");
  } catch (_) {}
}

function updateSplash(msg) {
  log(msg);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent = ${JSON.stringify(msg)}`
    ).catch(() => {});
  }
}

// ── Health Check ─────────────────────────────────────────────────
function waitForHealth(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let resolved = false;
    const check = () => {
      if (resolved) return;
      const req = http.get(url, (res) => {
        // Consume response body to free the socket
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolved = true;
          resolve(true);
        } else {
          retry();
        }
      });
      req.on("error", () => { if (!resolved) retry(); });
      req.setTimeout(3000, () => {
        req.destroy();
        if (!resolved) retry();
      });
    };
    const retry = () => {
      if (resolved) return;
      if (Date.now() - start > timeoutMs) {
        resolved = true;
        reject(new Error(`Health check timeout: ${url}`));
      } else {
        setTimeout(check, 2000);
      }
    };
    check();
  });
}

// ── PostgreSQL ───────────────────────────────────────────────────
function getPgBinDir() {
  // In dev mode, use system postgres if available
  if (isDev) {
    try {
      const pgConfig = execSync("pg_config --bindir", { encoding: "utf8" }).trim();
      if (pgConfig) return pgConfig;
    } catch (_) {}
    // Try common Homebrew / system paths
    const paths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/lib/postgresql/15/bin",
    ];
    for (const p of paths) {
      if (fs.existsSync(path.join(p, "pg_ctl"))) return p;
    }
  }
  // Packaged: use bundled postgres
  return path.join(resourcePath("postgres"), "bin");
}

// PostgreSQL shared libraries path (needed for bundled PG)
function getPgLibDir() {
  const bundledLib = path.join(resourcePath("postgres"), "lib");
  if (fs.existsSync(bundledLib)) return bundledLib;
  return "";
}

function pgExecEnv() {
  const pgLib = getPgLibDir();
  const env = { ...process.env };
  if (pgLib) {
    env.DYLD_LIBRARY_PATH = pgLib + (env.DYLD_LIBRARY_PATH ? ":" + env.DYLD_LIBRARY_PATH : "");
    env.LD_LIBRARY_PATH = pgLib + (env.LD_LIBRARY_PATH ? ":" + env.LD_LIBRARY_PATH : "");
  }
  // Point to bundled share directory for timezone/locale data
  const pgShare = path.join(resourcePath("postgres"), "share", "postgresql");
  if (fs.existsSync(pgShare)) {
    env.PGSHAREDIR = pgShare;
  }
  return env;
}

// The bundled postgres binary was built in a conda environment and has
// /private/tmp/pg_env/lib compiled in as its pkglibdir. Since pkglibdir
// cannot be overridden via env vars, we create a symlink pointing to the
// bundled lib directory so postgres can find its internal extensions.
function ensurePgSymlink() {
  const fakeRoot = "/tmp/pg_env";
  const pgRoot = resourcePath("postgres");
  const pgLib = path.join(pgRoot, "lib");
  const pgShareParent = path.join(pgRoot, "share");
  if (!fs.existsSync(pgLib)) return;
  try {
    // Create /tmp/pg_env directory if it doesn't exist
    if (!fs.existsSync(fakeRoot)) {
      fs.mkdirSync(fakeRoot, { recursive: true });
    }
    // Symlink lib -> bundled lib (overwrite if stale)
    const libLink = path.join(fakeRoot, "lib");
    try {
      const existing = fs.readlinkSync(libLink);
      if (existing !== pgLib) {
        fs.unlinkSync(libLink);
        fs.symlinkSync(pgLib, libLink);
        log(`Refreshed ${libLink} -> ${pgLib}`);
      }
    } catch {
      // Doesn't exist, create it
      fs.symlinkSync(pgLib, libLink);
      log(`Created ${libLink} -> ${pgLib}`);
    }
    // Symlink share -> bundled share
    const shareLink = path.join(fakeRoot, "share");
    if (fs.existsSync(pgShareParent)) {
      try {
        const existing = fs.readlinkSync(shareLink);
        if (existing !== pgShareParent) {
          fs.unlinkSync(shareLink);
          fs.symlinkSync(pgShareParent, shareLink);
        }
      } catch {
        fs.symlinkSync(pgShareParent, shareLink);
      }
    }
  } catch (e) {
    log(`Warning: could not create pg_env symlinks: ${e.message}`);
  }
}

async function startPostgres() {
  updateSplash("Starting PostgreSQL...");
  ensurePgSymlink();
  const pgBin = getPgBinDir();
  const pgCtl = path.join(pgBin, "pg_ctl");
  const initdb = path.join(pgBin, "initdb");
  const createdb = path.join(pgBin, "createdb");
  const env = pgExecEnv();

  if (!fs.existsSync(path.join(pgDataDir, "PG_VERSION"))) {
    updateSplash("Initializing database (first run)...");
    log(`initdb at ${pgDataDir}`);
    execSync(`"${initdb}" -D "${pgDataDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C`, {
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
    // Set port in postgresql.conf
    const confPath = path.join(pgDataDir, "postgresql.conf");
    fs.appendFileSync(confPath, `\nport = ${ports.pg}\n`);
  } else {
    // Update port in existing config
    const confPath = path.join(pgDataDir, "postgresql.conf");
    let conf = fs.readFileSync(confPath, "utf8");
    conf = conf.replace(/^port\s*=\s*\d+/m, `port = ${ports.pg}`);
    if (!/^port\s*=/m.test(conf)) conf += `\nport = ${ports.pg}\n`;
    fs.writeFileSync(confPath, conf);
  }

  return new Promise((resolve, reject) => {
    pgProcess = spawn(pgCtl, [
      "start", "-D", pgDataDir, "-l", path.join(logsDir, "postgres.log"), "-w",
    ], { stdio: "pipe", env });

    pgProcess.on("close", (code) => {
      if (code === 0) {
        log("PostgreSQL started");
        // Create infophysics database if not exists
        try {
          execSync(`"${createdb}" -h localhost -p ${ports.pg} -U postgres infophysics 2>/dev/null || true`, {
            encoding: "utf8", stdio: "pipe", env,
          });
        } catch (_) {}
        resolve();
      } else {
        reject(new Error(`pg_ctl start failed with code ${code}`));
      }
    });

    pgProcess.on("error", reject);
  });
}

function stopPostgres() {
  log("Stopping PostgreSQL...");
  try {
    const pgBin = getPgBinDir();
    execSync(`"${path.join(pgBin, "pg_ctl")}" stop -D "${pgDataDir}" -m fast`, {
      encoding: "utf8", stdio: "pipe", timeout: 10000, env: pgExecEnv(),
    });
  } catch (e) {
    log(`pg_ctl stop error: ${e.message}`);
  }
}

// ── Migrations ───────────────────────────────────────────────────
async function runMigrations() {
  updateSplash("Running database migrations...");
  const pythonPath = getPythonPath();
  const backendDir = isDev
    ? path.join(__dirname, "..", "infophysics_impl_grade")
    : resourcePath("backend");
  const dbUrl = `postgresql://postgres@localhost:${ports.pg}/infophysics`;

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ["-c", `
import psycopg, glob, os
os.chdir("${backendDir.replace(/\\/g, "/")}")
conn = psycopg.connect("${dbUrl}")
conn.execute("SET client_encoding TO 'UTF8'")
for f in sorted(glob.glob("migrations/*.sql")):
    print(f"Applying {f}...")
    sql = open(f, encoding="utf-8").read()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    except Exception as e:
        print(f"  Warning: {e}")
        conn.rollback()
conn.close()
print("Migrations done.")
`], { stdio: ["pipe", "pipe", "pipe"] });

    proc.stdout.on("data", (d) => log(`migration: ${d.toString().trim()}`));
    proc.stderr.on("data", (d) => log(`migration err: ${d.toString().trim()}`));
    proc.on("close", (code) => {
      if (code !== 0) log(`Migration exited with code ${code}`);
      resolve(); // Continue even if migrations have issues (tables may already exist)
    });
  });
}

// ── Python Path ──────────────────────────────────────────────────
function getPythonPath() {
  if (isDev) {
    // Use system python or locally installed one
    const localPython = path.join(
      process.env.HOME || "", ".local", "python", "bin", "python3.12"
    );
    if (fs.existsSync(localPython)) return localPython;
    try {
      execSync("python3.12 --version", { stdio: "pipe" });
      return "python3.12";
    } catch (_) {}
    try {
      execSync("python3 --version", { stdio: "pipe" });
      return "python3";
    } catch (_) {}
    return "python3";
  }
  // Packaged: bundled Python
  const bundled = path.join(resourcePath("python"), "bin", "python3.12");
  return fs.existsSync(bundled) ? bundled : "python3";
}

// ── Backend (FastAPI) ────────────────────────────────────────────
async function startBackend() {
  updateSplash("Starting backend API...");
  const pythonPath = getPythonPath();
  const backendDir = isDev
    ? path.join(__dirname, "..", "infophysics_impl_grade")
    : resourcePath("backend");
  const dbUrl = `postgresql://postgres@localhost:${ports.pg}/infophysics`;

  backendProcess = spawn(pythonPath, [
    "-m", "uvicorn", "api.main:app",
    "--host", "0.0.0.0", "--port", String(ports.backend),
  ], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      CORS_ORIGINS: JSON.stringify([
        `http://localhost:${ports.frontend}`,
        `http://127.0.0.1:${ports.frontend}`,
      ]),
      DEMO_TENANT_ID: "tenantA",
      PORT: String(ports.backend),
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  backendProcess.stdout.on("data", (d) => log(`backend: ${d.toString().trim()}`));
  backendProcess.stderr.on("data", (d) => log(`backend: ${d.toString().trim()}`));
  backendProcess.on("close", (code) => log(`Backend exited: ${code}`));

  await waitForHealth(`http://127.0.0.1:${ports.backend}/`);
  log("Backend healthy");
}

// ── Frontend (Next.js) ───────────────────────────────────────────
async function startFrontend() {
  updateSplash("Starting frontend...");
  const frontendDir = isDev
    ? path.join(__dirname, "..")
    : resourcePath("frontend");

  const serverJs = path.join(frontendDir, "server.js");

  if (isDev && !fs.existsSync(serverJs)) {
    // Dev mode: use next dev instead of standalone
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    frontendProcess = spawn(npx, ["next", "dev", "--port", String(ports.frontend)], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        API_BASE: `http://localhost:${ports.backend}`,
        PORT: String(ports.frontend),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    // Production: use Electron's bundled Node binary to run standalone server.js
    const electronExe = process.execPath;
    // Electron can run as Node with ELECTRON_RUN_AS_NODE=1
    frontendProcess = spawn(electronExe, [path.join(frontendDir, "server.js")], {
      cwd: frontendDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        API_BASE: `http://127.0.0.1:${ports.backend}`,
        PORT: String(ports.frontend),
        HOSTNAME: "0.0.0.0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  frontendProcess.stdout.on("data", (d) => log(`frontend: ${d.toString().trim()}`));
  frontendProcess.stderr.on("data", (d) => log(`frontend: ${d.toString().trim()}`));
  frontendProcess.on("close", (code) => log(`Frontend exited: ${code}`));

  await waitForHealth(`http://127.0.0.1:${ports.frontend}/`);
  log("Frontend healthy");
}

// ── Windows ──────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${ports.frontend}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── Graceful Shutdown ────────────────────────────────────────────
function killProcess(proc, name) {
  if (!proc || proc.killed) return;
  log(`Killing ${name} (pid ${proc.pid})...`);
  try {
    treeKill(proc.pid, "SIGTERM");
  } catch (e) {
    log(`Kill ${name} error: ${e.message}`);
  }
}

function shutdown() {
  log("Shutting down...");
  killProcess(frontendProcess, "frontend");
  killProcess(backendProcess, "backend");
  stopPostgres();
  log("Shutdown complete.");
}

// ── App Lifecycle ────────────────────────────────────────────────
app.on("ready", async () => {
  log(`${APP_NAME} starting (dev=${isDev})`);
  createSplash();

  try {
    await findPorts();
    await startPostgres();
    await runMigrations();
    await startBackend();
    await startFrontend();

    updateSplash("Ready!");
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      createMainWindow();
    }, 500);
  } catch (err) {
    log(`Startup error: ${err.message}`);
    dialog.showErrorBox(
      "AIO System App — Startup Error",
      `Failed to start services:\n\n${err.message}\n\nCheck logs at:\n${logsDir}`
    );
    shutdown();
    app.quit();
  }
});

app.on("before-quit", shutdown);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    shutdown();
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});
