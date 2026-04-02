

## Plan: Fix Template Names, Automations Page Stability, and Bot Trigger Execution

### Problem Summary
1. **Template names** show raw Meta suffixes like `_w9yunp` -- need to strip the last `_` segment
2. **Automations page** calls `fetchData()` after every action, causing full re-render/reload
3. **Bot automations don't execute** because:
   - The stage move calls a non-existent `bot-trigger` function
   - No code reads `crm_automations` table to execute configured actions (send_bot, send_template, etc.) when a lead enters a stage

---

### Step 1 -- Strip Suffix from Template Display Names

**File**: `src/pages/CrmModelos.tsx`

Create a helper function that removes the last `_xxxxx` segment from template names (where the last segment looks like a random hash -- short alphanumeric suffix). Display the cleaned name in the template card (line 335) while keeping the raw name for API operations.

```typescript
const displayName = (name: string) => {
  // Remove last _segment if it looks like a random suffix (alphanumeric, ≤8 chars)
  return name.replace(/_[a-z0-9]{4,8}$/, '');
};
```

Apply on line 335: `{displayName(t.name)}`

---

### Step 2 -- Prevent Full Page Reload on CrmAutomacoes

**File**: `src/pages/CrmAutomacoes.tsx`

Instead of calling `fetchData(selectedPipelineId)` after every mutation (which re-fetches all pipelines, stages, automations, templates, bots, channels, followups), update state locally:

- **Save automation**: After insert/update, add/update the automation in `automations` state directly
- **Delete automation**: Remove from `automations` state directly
- **Toggle automation**: Update in state directly
- **Add stage**: Append to `stages` state
- **Delete stage**: Remove from `stages` state
- **Drag reorder**: Already updates state locally (keep as is)
- Keep `fetchData` only for initial load and pipeline switching

---

### Step 3 -- Fix Bot Trigger on Stage Move and Execute Automations

**File**: `src/hooks/useChatConversation.ts`

The current code (lines 231-239) calls a non-existent `bot-trigger` function. Replace with:

1. After moving a lead to a new stage, query `crm_automations` for automations matching `stage_id = newStageId` and `trigger_type = 'on_enter'` and `is_active = true`
2. For each automation found:
   - `send_bot`: Call `bot-engine` with `trigger: "manual_start"` and the configured `bot_id`
   - `send_template`: Send the template via `send-whatsapp-message`
   - `move_stage`: Move lead to target stage
   - `webhook`: Call the configured URL
3. Use `supabase.functions.invoke("bot-engine", ...)` instead of raw fetch to a non-existent endpoint

Similarly, ensure automations with `trigger_type = 'on_create'` fire when leads are created (check if this path exists and fix if needed).

---

### Technical Details

| File | Changes |
|------|---------|
| `src/pages/CrmModelos.tsx` | Add `displayName()` helper, use it in template card |
| `src/pages/CrmAutomacoes.tsx` | Replace `fetchData()` calls in mutation handlers with local state updates |
| `src/hooks/useChatConversation.ts` | Replace broken `bot-trigger` call with automation lookup + execution logic |

