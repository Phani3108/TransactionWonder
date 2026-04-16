# TransactionWonder Quick Start Guide

## 🚨 Fixed Issues

### Login Page Font Visibility
The login page fonts are now **fully visible**:
- ✅ Fixed invisible text caused by dark mode conflicts
- ✅ Login page now forces light mode temporarily
- ✅ Input fields have explicit text colors
- ✅ App now defaults to light mode on first load

### Authentication Errors
You were getting 401 errors because you need to log in with valid credentials. Follow these steps:

### Step 1: Clear Invalid Token (Automatic)

The app now automatically clears expired tokens and redirects to login. Just refresh your browser:

```bash
# The app will automatically redirect you to /login
```

### Step 2: Set Up Database & Demo Users

Run the all-in-one setup script:

```bash
bun run setup:full
```

This creates the database schema and 6 demo users in one command.

This will create two sets of demo users:

**Simple Credentials** (password123):
- **admin@demo.com** (Tenant Admin - full access)
- **accountant@demo.com** (Accountant - financial operations)
- **viewer@demo.com** (Viewer - read-only access)

**Meridian Tech Credentials** (Demo123!):
- **admin@meridiantech.example** (Alex Rivera - Tenant Admin)
- **accountant@meridiantech.example** (Jordan Chen - Accountant)
- **viewer@meridiantech.example** (Sam Taylor - Viewer)

### Step 3: Log In

1. Navigate to `http://localhost:3000/login`
2. Use these credentials:
   - **Email**: `admin@demo.com`
   - **Password**: `password123`
3. Click "Sign In"

### Step 4: Test the Command Center

After logging in, you should be able to:

✅ **Command Center** (`/agents/command-center`)
- Type natural language commands
- Deploy agents with one prompt
- Watch real-time execution

✅ **Agent Console** (`/agents/console`)
- Select any agent (all 110 now visible!)
- Execute tasks on specific agents
- View execution history

✅ **All Agents** (`/agents`)
- See all agents organized by type
- Start/Stop individual agents
- View real-time status

## 🔧 Alternative: If Database Isn't Set Up

If you get database errors, run the full setup:

```bash
# 1. Make sure PostgreSQL is running
# 2. Create the database
createdb transactionwonder

# 3. Set up the database schema
bun run db:setup

# 4. Create demo users
bun run setup:demo
```

## 🌐 Environment Variables

Your `.env` file should have:

```env
# Database
DATABASE_URL=postgresql://localhost:5432/transactionwonder

# API Server
PORT=9100

# JWT Authentication
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# DeepSeek API (Required for AI features)
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

**Get your DeepSeek API key**: https://platform.deepseek.com/api_keys

## 🚀 Running the Application

### Terminal 1: API Server
```bash
bun run dev
```

Wait for: "Ready for requests..."

### Terminal 2: Dashboard
```bash
bun run dashboard:dev
```

Wait for: "Local: http://localhost:3000"

Then open `http://localhost:3000` in your browser.

## 📋 What Changed

I've fixed the agent deployment system:

1. ✅ **Created Orchestration Service** - The missing file that was breaking the server
2. ✅ **Added Command Center** - One-prompt agent deployment UI
3. ✅ **Improved Agent Selector** - Search, filter, all workers visible
4. ✅ **Added Agent Controls** - Start/Stop buttons on each agent
5. ✅ **Better Auth Handling** - Automatic token cleanup and redirect

## 🔍 Troubleshooting

### Still Getting 401 Errors?
1. Open browser DevTools (F12)
2. Go to Application → Local Storage
3. Delete `transactionwonder_token` and `transactionwonder_user`
4. Refresh the page
5. Log in again

### Can't Connect to Database?
```bash
# Check if PostgreSQL is running
psql --version
pg_isready

# Recreate database
dropdb transactionwonder
createdb transactionwonder
bun run db:setup
bun run setup:demo
```

### API Server Not Starting?
```bash
# Check if port 4004 is in use
lsof -i :4004  # Mac/Linux
netstat -ano | findstr :4004  # Windows

# Kill the process or use a different port in .env
```

## 🎉 You're Ready!

Once logged in, try the Command Center:

1. Go to `/agents/command-center`
2. Type: "Generate monthly P&L report and reconcile all accounts"
3. Click "Create Execution Plan"
4. Review the plan
5. Click "Execute Plan"

Watch as TransactionWonder orchestrates multiple AI agents to complete your task!

---

**Need Help?** Check the main README.md for detailed documentation.
