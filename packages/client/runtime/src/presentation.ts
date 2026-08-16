/** Platform-neutral Conversation projection engine and data contracts. */
export { ConversationEventRegistry } from './client/conversation/event-registry.ts'
export { ConversationViewRegistry } from './client/conversation/view-registry.ts'
export { ConversationNodeAssembler } from './client/sessions/conversation-assembler.ts'
export { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
export { displayFailureMessage } from './client/sessions/failure-display.ts'
export {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, toAssistantBlock, toAssistantBlocks,
} from './client/sessions/conversation.ts'
export { emptyAssistantBlock } from './client/sessions/partial.ts'
export { isTokenDelta } from './client/sessions/assistant-timing.ts'
export { contextForm, contextProvenance } from './client/sessions/context-provenance.ts'
export type {
  ConversationEventDefinitions, ConversationRuntime, ConversationViewDefinitions,
} from './client/sessions/conversation-assembler.ts'
export type {
  ChatConversationViewNode, ConversationContextReader, ConversationEventInput,
  ConversationLocation, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
  ConversationPublication, ConversationTimelineSnapshot, ConversationTurnDataMap,
  ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
  ConversationViewSnapshotMap, ConversationViewSnapshotStore, StepLocation, TurnLocation,
} from './client/contract/conversation.ts'
export type {
  AssistantBlock, AssistantMessageNode, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot,
  CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  LegacyConversationSlice, ModelRetryNode, PartialAssistant, RunningToolCall, SteeringMessageNode,
  ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UnknownSurfaceNode,
  UserMessageNode,
} from './client/sessions/conversation.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from './client/sessions/context-provenance.ts'
