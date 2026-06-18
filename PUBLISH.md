# Publish — Scry MCP + Skills (outward-facing, braucht Michaels Account)

Code ist fertig + getestet. Diese Schritte sind die einzigen, die einen Login brauchen
(GitHub / npm) — deshalb von Claude vorbereitet, von dir ausgeführt.

## 1. scry-mcp → npm (MCP-Server)
```bash
cd ~/Desktop/Claude-cowork/scry-mcp
npm publish --access public           # erfordert `npm login` (dein npm-Account)
# danach nutzbar via:  npx scry-mcp   (stdio MCP server)
```
MCP-Client-Eintrag (Beispiel Claude Desktop / Cursor config):
```json
{ "mcpServers": { "scry": { "command": "npx", "args": ["-y", "scry-mcp"],
  "env": { "SCRY_BASE_URL": "https://scry.solanahub.de" } } } }
```
Optional danach: in MCP-Registries listen (z.B. modelcontextprotocol/registry,
mcp.so, smithery) — reine Sichtbarkeit, keine Pflicht.

## 2. scry-skills → GitHub + skills.sh
```bash
cd ~/Desktop/Claude-cowork/scry-skills
# Repo auf deinem GitHub-Account anlegen (Name z.B. scry-skills), dann:
git remote add origin git@github.com:<DEIN-OWNER>/scry-skills.git
git push -u origin main
# danach auffindbar/installierbar:
npx skills add <DEIN-OWNER>/scry-skills
```
skills.sh indexiert öffentliche Repos mit SKILL.md automatisch.

## Hinweis
Beides ist **Auffindbarkeit**, kein Demand-Hebel (siehe Vault
`2026-06-18-scry-quality-parity-backlog.md`). Reihenfolge egal. Kein Helius-Credit, kein
Live-Service-Kontakt.
