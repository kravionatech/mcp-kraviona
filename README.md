# Kraviona Admin MCP Server

Claude se seedha kraviona.com ka admin panel control karo.

## Kya kya kar sakte ho Claude se:
- 📝 Blog posts create / update / delete
- 📊 Dashboard analytics dekhna
- 🎯 Leads track aur update karna
- 💬 Messages read aur reply status update
- 🗂️ Categories manage karna
- 👥 Team members manage karna
- 📧 Newsletter subscribers dekhna
- 💬 Comments moderate karna

## Setup Steps

### Step 1 — Files apne system pe rakho
```bash
git clone / ya zip extract karo
cd kraviona-mcp
npm install
```

### Step 2 — .env file banao
```bash
cp .env.example .env
```
Phir `.env` file mein apna email aur password daalo.

### Step 3 — Claude Desktop Config update karo

**Windows path:**
```
C:\Users\<YourName>\AppData\Roaming\Claude\claude_desktop_config.json
```

**Mac path:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Is config mein yeh add karo:
```json
{
  "mcpServers": {
    "kraviona-admin": {
      "command": "node",
      "args": ["C:/FULL/PATH/TO/kraviona-mcp/index.js"],
      "env": {
        "KRAVIONA_API_URL": "https://api.kraviona.com/api/v1",
        "KRAVIONA_EMAIL": "your-email@kraviona.com",
        "KRAVIONA_PASSWORD": "yourpassword"
      }
    }
  }
}
```

> ⚠️ Windows mein path mein forward slash `/` use karo, backslash nahi

### Step 4 — Claude Desktop restart karo

Bas! Ab Claude se directly bol sako:
- "Mere saare leads dikao"
- "Ek naya blog post banao MERN stack ke baare mein"
- "Dashboard analytics dikhao"
- "Is lead ka status 'contacted' karo"

## Available Tools (24 total)

| Category | Tools |
|---|---|
| Dashboard | get_dashboard |
| Posts/Blog | get_posts, get_single_post, create_post, update_post, delete_post |
| Leads | get_leads, get_lead, update_lead, delete_lead |
| Messages | get_messages, get_message, update_message, delete_message |
| Categories | get_categories, create_category, delete_category |
| Newsletter | get_subscribers, delete_subscriber |
| Comments | get_comments, update_comment, delete_comment |
| Team | get_team, create_team_member, update_team_member, delete_team_member |
| Users | get_users |
# mcp-kraviona
