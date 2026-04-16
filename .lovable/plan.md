

## Plan: Fix 3 Issues (Recorder Speed, Pipeline Stage Move, Lead Creation Pipeline)

### Issue 1: Audio recorder too slow to start
**Root cause**: The 120ms `setTimeout` delay plus `AudioContext` creation and `getUserMedia` happen sequentially. The `onstart` callback pattern adds perceived delay since UI only updates after the recorder fires its start event.

**Fix in `AudioRecorderComposer.tsx`**:
- Remove the 120ms warmup delay entirely -- modern browsers don't need it
- Show "recording" UI immediately after `recorder.start()` instead of waiting for the `onstart` event
- Move `startMeter()` and `startRecordingTimer()` to fire right after `recorder.start()` call, keeping `onstart` only as a safety fallback

### Issue 2: Moving lead to another pipeline's stage doesn't update `pipeline_id`
**Root cause**: `PipelineStageSelector` calls `onStageChange(stageId)` but only passes the stage ID. The `handleStageChange` in `useChatConversation.ts` updates only `stage_id` on the lead, never `pipeline_id`. So moving to a stage in a different pipeline leaves the lead in the old pipeline.

**Fix**:
- Update `PipelineStageSelector` to also pass `pipeline_id` when calling `onStageChange`
- Change `onStageChange` signature to `(stageId: string, pipelineId: string) => void`
- Update `handleStageChange` in `useChatConversation.ts` to accept and update `pipeline_id` alongside `stage_id`
- Update consumers in `CrmConversas.tsx` and `CrmConversa.tsx` to propagate `pipeline_id` in local state

### Issue 3: Lead creation dialog has no pipeline selector
**Root cause**: The "Novo Lead" dialog in `CrmKanban.tsx` only shows stages from the currently selected pipeline. There's no way to pick a different pipeline.

**Fix in `CrmKanban.tsx`**:
- Add a "Funil" select above the "Etapa Inicial" select in the create lead dialog
- Default to the currently viewed pipeline
- Filter stage options by selected pipeline
- Update `insertNewLead` to use the selected pipeline ID instead of always using `pipeline.id`

### Files to edit
1. `src/components/chat/AudioRecorderComposer.tsx` -- remove delay, immediate UI feedback
2. `src/components/chat/PipelineStageSelector.tsx` -- pass pipeline_id with stage change
3. `src/hooks/useChatConversation.ts` -- update pipeline_id on stage change
4. `src/pages/CrmConversas.tsx` -- adapt to new onStageChange signature
5. `src/pages/CrmConversa.tsx` -- adapt to new onStageChange signature
6. `src/pages/CrmKanban.tsx` -- add pipeline selector to create lead dialog

