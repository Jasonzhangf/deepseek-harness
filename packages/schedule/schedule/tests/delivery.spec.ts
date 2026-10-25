import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { createAfterScheduleRecord, ScheduleId } from '../src/domain.ts'
import { ScheduleRuntime } from '../src/runtime.ts'
import type { ScheduleTask } from '../src/storage.ts'

class ReminderAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Reminder processed' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Reminder processed' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

for (const initiallyRunning of [false, true]) {
  it(initiallyRunning ? 'steers the next step of the same running turn' : 'starts an idle Agent without a manual wake', async () => {
    const ctx = new Context()
    let runtime: ScheduleRuntime | undefined
    try {
      await mountAgentLoopTestDependencies(ctx)
      ctx.llm.registerAdapter(['schedule-test'], new ReminderAdapter())
      const loop = await mountAgentLoopTestHarness(ctx)
      const agent = await loop.create(SessionId('automatic-reminder'), { provider: 'schedule-test', model: 'model' })
      const claimed: Array<{ turn: number; step: number }> = []
      ctx.on('agent/pre-step', async (payload, next) => {
        if (payload.messages.some(message => message.source.kind === 'schedule')) {
          claimed.push({ turn: payload.turn, step: payload.step })
        }
        return next()
      })
      ctx.on('session/flush', async () => {})
      const record = createAfterScheduleRecord(ScheduleId('automatic'), 'Inspect the reminder', 1, Date.now() - 2000, 'Inspect the reminder')
      const tasks: ScheduleTask[] = [{ sessionId: agent.session.id, record, status: 'active' }]
      const committed = Promise.withResolvers<undefined>()
      runtime = new ScheduleRuntime(ctx, () => tasks, work => work(), async (updated) => {
        tasks[0] = updated
        committed.resolve(undefined)
      }, { days: 30, records: 200 }, async () => agent)
      if (initiallyRunning) {
        let fired = false
        ctx.on('agent/turn-stopping', async () => {
          if (fired) return
          fired = true
          expect(agent.status).toBe('running')
          runtime!.requestDrive()
          await committed.promise
        })
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Initial work' }], source: { kind: 'user' } }))
      } else {
        expect(agent.status).toBe('idle')
        runtime.requestDrive()
      }
      await committed.promise
      await agent.whenIdle()
      expect(claimed).toEqual([{ turn: 1, step: initiallyRunning ? 2 : 1 }])
      const events = agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.some(event => event.type === 'assistant/message')).toBe(true)
      expect(agent.inbox.nextStep).toHaveLength(0)
      expect(agent.inbox.nextTurn).toHaveLength(0)
    } finally {
      await runtime?.dispose()
      await ctx.fiber.dispose()
    }
  })
}

it('acknowledges the real synchronous inbox splice after flush without claiming model execution', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-16T00:00:02.000Z'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    const loop = await mountAgentLoopTestHarness(ctx)
    const agent = await loop.create(SessionId('delivery-owner'))
    // Maintenance holds model execution while the production followup still records inbox input.
    const releaseMaintenance = Promise.withResolvers<undefined>()
    const maintenance = agent.runMaintenance(() => releaseMaintenance.promise)
    try {
      const resolve = vi.fn(async (_sessionId: SessionId) => ({ agent }))
      ctx.provide('sessionController', { resolveAgent: resolve } as never)
      const record = createAfterScheduleRecord(ScheduleId('receipt'), 'Inbox only', 1, Date.now() - 2000, 'Inbox only')
      const tasks: ScheduleTask[] = [{ sessionId: agent.session.id, record, status: 'active' }]
      const flushStarted = Promise.withResolvers<undefined>()
      const releaseFlush = Promise.withResolvers<undefined>()
      let eventsAtFlush: readonly SessionEvent[] = []
      ctx.on('session/flush', (session) => {
        eventsAtFlush = session.snapshotEvents()
        flushStarted.resolve(undefined)
        return releaseFlush.promise
      })
      const commit = vi.fn(async (task: ScheduleTask) => { tasks[0] = task })
      const runtime = new ScheduleRuntime(ctx, () => tasks, work => work(), commit, { days: 30, records: 200 },
        async sessionId => (await resolve(sessionId)).agent)
      try {
        runtime.requestDrive()
        await flushStarted.promise
        expect(resolve).toHaveBeenCalledWith(agent.session.id)
        const inserted = eventsAtFlush.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
        expect(inserted).toHaveLength(1)
        expect(inserted[0]?.source).toEqual({ kind: 'schedule' })
        expect(agent.inbox.nextTurn).toEqual(inserted)
        expect(commit).not.toHaveBeenCalled()
        expect(tasks).toEqual([{ sessionId: agent.session.id, record, status: 'active' }])
        vi.setSystemTime(new Date('2026-09-16T00:00:03.000Z'))
        releaseFlush.resolve(undefined)
        await runtime.dispose()
        expect(commit).toHaveBeenCalledTimes(1)
        expect(tasks).toEqual([{
          sessionId: agent.session.id, record, status: 'inactive',
          deliveryHistory: { records: [{
            scheduledAt: record.scheduledAt, deliveredAt: '2026-09-16T00:00:03.000Z', messageId: inserted[0]!.id,
            prompt: 'Inbox only',
          }], earlierRecordsUnavailable: true, earlierRecordsPruned: false },
          lastDelivery: {
            scheduledAt: record.scheduledAt, deliveredAt: '2026-09-16T00:00:03.000Z', messageId: inserted[0]!.id,
          },
        }])
        expect(agent.inbox.nextTurn).toEqual(inserted)
        expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
      } finally {
        releaseFlush.resolve(undefined)
        await runtime.dispose()
      }
    } finally {
      agent.cancel({ kind: 'user' })
      releaseMaintenance.resolve(undefined)
      await maintenance
    }
  } finally {
    await ctx.fiber.dispose()
    vi.useRealTimers()
  }
})
