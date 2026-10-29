import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post, put } from '../../lib/api';
import { selectionIds } from '@examledger/contracts';
const canonical = (answers) =>
  JSON.stringify(
    answers
      .map((a) => ({ questionId: a.questionId, choiceIds: selectionIds(a) }))
      .sort((a, b) => a.questionId.localeCompare(b.questionId)),
  );
export function useAttempt(id, userId) {
  const key = `examledger:draft:${userId}:${id}`;
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState(null);
  const [state, setState] = useState('loading');
  const [conflict, setConflict] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const current = useRef({
    answers: [],
    saved: '[]',
    version: 0,
    active: false,
    dirty: false,
    conflict: false,
  });
  const inFlight = useRef(null);
  const clock = useRef(null);
  const persist = useCallback(() => {
    const c = current.current;
    try {
      if (c.dirty)
        localStorage.setItem(key, JSON.stringify({ answers: c.answers, baseVersion: c.version }));
      else localStorage.removeItem(key);
    } catch {
      setError(
        new Error(
          'Local draft storage is unavailable. Keep this page open until all answers are saved.',
        ),
      );
    }
  }, [key]);
  const acceptReceipt = useCallback(
    (receipt) => {
      current.current.active = false;
      current.current.dirty = false;
      try {
        localStorage.removeItem(key);
      } catch {
        /* A storage failure must not hide a server receipt. */
      }
      setAttempt(receipt);
      setState('submitted');
    },
    [key],
  );
  const syncClock = (a) => {
    clock.current = {
      received: performance.now(),
      server: new Date(a.serverNow).getTime(),
      deadline: new Date(a.deadline).getTime(),
    };
    setRemaining(Math.max(0, Math.ceil((clock.current.deadline - clock.current.server) / 1000)));
  };
  const load = useCallback(async () => {
    try {
      const a = await api(`/student/attempts/${id}`);
      if (a.status === 'submitted') {
        acceptReceipt(a);
        return;
      }
      let draft;
      try {
        draft = JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        /* An unreadable cache cannot replace saved server answers. */
      }
      const validDraft =
        draft &&
        Number.isInteger(draft.baseVersion) &&
        Array.isArray(draft.answers) &&
        draft.answers.every(
          (v) =>
            v &&
            typeof v === 'object' &&
            a.questions.some(
              (q) =>
                q.id === v.questionId &&
                selectionIds(v).length > 0 &&
                new Set(selectionIds(v)).size === selectionIds(v).length &&
                (q.type === 'multiple' || selectionIds(v).length === 1) &&
                selectionIds(v).every((id) => q.choices.some((c) => c.id === id)),
            ),
        ) &&
        new Set(draft.answers.map((v) => v.questionId)).size === draft.answers.length;
      const differs = validDraft && canonical(draft.answers) !== canonical(a.answers);
      const conflicting = differs && draft.baseVersion !== a.version;
      const recovered = differs ? draft.answers : a.answers;
      current.current = {
        answers: recovered,
        saved: canonical(a.answers),
        version: a.version,
        active: true,
        dirty: Boolean(differs),
        conflict: Boolean(conflicting),
      };
      setAttempt(a);
      setAnswers(recovered);
      syncClock(a);
      setConflict(conflicting ? a : null);
      setState(conflicting ? 'conflict' : differs ? 'pending' : 'saved');
      setError(null);
      persist();
    } catch (err) {
      setError(err);
      setState('error');
    }
  }, [id, key, acceptReceipt, persist]);
  useEffect(() => {
    load();
  }, [load]);
  const save = useCallback(async () => {
    if (inFlight.current) {
      await inFlight.current;
      return;
    }
    const c = current.current;
    if (!c.active || !c.dirty || c.conflict) return;
    const snapshot = [...c.answers];
    const version = c.version;
    setState('saving');
    const operation = (async () => {
      try {
        const response = await put(`/student/attempts/${id}/answers`, {
          version,
          answers: snapshot,
        });
        if (response.status === 'submitted') {
          acceptReceipt(response);
          return;
        }
        c.version = response.version;
        c.saved = canonical(snapshot);
        c.dirty = canonical(c.answers) !== c.saved;
        setState(c.dirty ? 'pending' : 'saved');
        setError(null);
        persist();
      } catch (err) {
        if (err.code === 'VERSION_CONFLICT') {
          const remote = await api(`/student/attempts/${id}`);
          if (remote.status === 'submitted') {
            acceptReceipt(remote);
            return;
          }
          // A response may have been lost after the server committed the previous save.
          if (canonical(remote.answers) === canonical(snapshot)) {
            c.version = remote.version;
            c.saved = canonical(snapshot);
            c.dirty = canonical(c.answers) !== c.saved;
            setState(c.dirty ? 'pending' : 'saved');
            persist();
            return;
          }
          c.conflict = true;
          setConflict(remote);
          setState('conflict');
          setError(null);
        } else {
          setState('pending');
          setError(err);
        }
      }
    })();
    inFlight.current = operation;
    try {
      await operation;
    } finally {
      inFlight.current = null;
    }
  }, [id, acceptReceipt, persist]);
  useEffect(() => {
    const timer = setInterval(() => {
      save().catch((err) => setError(err));
    }, 1200);
    const online = () => {
      save().catch((err) => setError(err));
    };
    const offline = () => {
      if (current.current.active) {
        setState('offline');
        post(`/student/attempts/${id}/events`, { type: 'offline' }).catch(() => {});
      }
    };
    const visibility = () => {
      if (document.hidden && current.current.active)
        post(`/student/attempts/${id}/events`, { type: 'visibility-hidden' }).catch(() => {});
    };
    const fullscreen = () => {
      if (!document.fullscreenElement && current.current.active)
        post(`/student/attempts/${id}/events`, { type: 'fullscreen-exit' }).catch(() => {});
    };
    const beforeUnload = (e) => {
      if (current.current.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', fullscreen);
    };
  }, [id, save]);
  useEffect(() => {
    let finalizing = false;
    const timer = setInterval(async () => {
      if (!clock.current || !current.current.active) return;
      const c = clock.current;
      const seconds = Math.max(
        0,
        Math.ceil((c.deadline - c.server - (performance.now() - c.received)) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0 && !finalizing) {
        finalizing = true;
        try {
          acceptReceipt(await post(`/student/attempts/${id}/submit`));
        } catch (err) {
          setError(err);
        } finally {
          finalizing = false;
        }
      }
    }, 500);
    return () => clearInterval(timer);
  }, [id, acceptReceipt]);
  // Periodic server resynchronization also recovers submission made in another tab.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!current.current.active) return;
      try {
        const a = await api(`/student/attempts/${id}`);
        if (a.status === 'submitted') acceptReceipt(a);
        else syncClock(a);
      } catch {
        /* Autosave reports connectivity errors. */
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [id, acceptReceipt]);
  function choose(questionId, choiceId) {
    if (!current.current.active || current.current.conflict || remaining <= 0) return;
    const c = current.current;
    const choiceIds = Array.isArray(choiceId) ? [...choiceId].sort() : choiceId ? [choiceId] : [];
    c.answers = [
      ...c.answers.filter((a) => a.questionId !== questionId),
      ...(choiceIds.length ? [{ questionId, choiceIds }] : []),
    ];
    c.dirty = canonical(c.answers) !== c.saved;
    setAnswers(c.answers);
    setState(c.dirty ? 'pending' : 'saved');
    persist();
  }
  async function submit() {
    await save();
    if (current.current.dirty) await save();
    if (current.current.conflict) throw new Error('Resolve the answer conflict before submitting.');
    if (current.current.dirty)
      throw new Error(
        'Some answers have not reached the server. Restore your connection and retry before the deadline.',
      );
    acceptReceipt(await post(`/student/attempts/${id}/submit`));
  }
  function resolve(useLocal) {
    const c = current.current;
    c.version = conflict.version;
    c.saved = canonical(conflict.answers);
    if (!useLocal) c.answers = conflict.answers;
    c.dirty = canonical(c.answers) !== c.saved;
    c.conflict = false;
    setAnswers(c.answers);
    setConflict(null);
    setState(c.dirty ? 'pending' : 'saved');
    persist();
  }
  return {
    attempt,
    answers,
    error,
    state,
    remaining,
    conflict,
    choose,
    submit,
    resolve,
    retry: load,
    save,
  };
}
