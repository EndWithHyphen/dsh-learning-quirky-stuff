import { validatePurge } from '../trash.js';

/** SDK-independent command routing; legacy actions remain backward compatible. */
export async function executeStudyAction(app, request) {
  if (app.runtime.has(request?.action)) return app.runtime.execute(request);
  switch (request?.action) {
    case 'duplicate': {
      const result = await app.learning.dispatch(request);
      await app.runtime.pdf.duplicate(request.id, result.id);
      return app.store.read(result.id);
    }
    case 'setSummaryDeleted': {
      const result = await app.store.setSummaryDeleted(request);
      await app.jobs.summaryChanged(result.summary);
      if (request.deleted) {
        await app.graphJobs.forgetSummaries([request.summaryId]);
        await app.runtime.summaryDeleted(request.summaryId);
      }
      return result;
    }
    case 'purgeNotes': {
      const ids = await validatePurge(app.learning, request);
      await Promise.all([
        app.jobs.forgetBoards(ids),
        app.graphJobs.forgetBoards(ids),
        app.runtime.beforePurge(ids),
      ]);
      const result = await app.learning.purge(request, {
        afterDelete: async (removed) => {
          await app.capture.forgetBoards(removed);
          await app.runtime.purge(removed);
        },
      });
      return result;
    }
    case 'metadata': {
      const result = await app.learning.dispatch(request);
      if (request.deleted) await app.runtime.noteDeleted(request.id);
      return result;
    }
    case 'backup':
      return {
        ...(await app.learning.dispatch(request)),
        modules: await app.runtime.backup({ separateFiles: request.separateFiles === true }),
      };
    case 'summaryTask':
      return app.jobs.latest(request.id);
    case 'startGraphAi':
      return app.graphJobs.start(request);
    case 'graphAiStatus':
      return app.graphJobs.get(request.jobId);
    case 'cancelGraphAi':
      return app.graphJobs.cancel(request.jobId);
    case 'graph':
      return { ...(await app.learning.graph()), aiJob: app.graphJobs.get() };
    default:
      return app.learning.dispatch(request);
  }
}
