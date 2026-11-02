// One inference service, one decision per synchronized cohort. Live backends stay manual.
export class BotRunner {
  constructor(comparison, { busy = () => false } = {}) {
    this.comparison = comparison;
    this.busy = busy;
    this.observed = new Map();
    this.running = false;
    this.closed = false;
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 500);
    this.timer.unref();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
  groups() {
    const sync = this.comparison.sync,
      seen = new Set(),
      groups = [];
    for (const source of sync.participants()) {
      if (seen.has(source)) continue;
      const targets = sync.targets(source);
      for (const w of targets) seen.add(w);
      const bots = sync.botPolicies(targets);
      if (Object.keys(bots).length)
        groups.push({
          source,
          targets,
          bots,
          key: targets
            .map((w) => w.clone.game_id)
            .sort()
            .join(":"),
          policy: JSON.stringify(Object.entries(bots).sort()),
        });
    }
    return groups;
  }
  async tick() {
    if (
      this.closed ||
      this.running ||
      this.busy() ||
      this.comparison.sync.error
    )
      return;
    this.running = true;
    try {
      const groups = this.groups();
      const keys = new Set(groups.map((g) => g.key));
      for (const key of this.observed.keys())
        if (!keys.has(key)) this.observed.delete(key);
      for (const group of groups) {
        if (this.closed || this.busy()) break;
        const { source, targets, bots, key, policy } = group;
        try {
          const current = await this.comparison.api(
            `/games/${source.clone.game_id}`,
            undefined,
            "GET",
          );
          const fingerprint = current.hash + policy;
          if (this.observed.get(key) === fingerprint) continue;
          const snapshot = await this.comparison.api(
            `/games/${source.clone.game_id}/bot-state`,
            undefined,
            "GET",
          );
          const result = await this.comparison.services.botRequest(
            "/decision",
            { ...snapshot, bots, seed: source.clone.game_id },
          );
          const work = this.comparison.sync.queue.then(async () => {
            if (this.closed || this.busy()) return;
            const live = this.groups().find(
              (g) => g.key === key && g.policy === policy,
            );
            if (!live) return;
            if (!result.decision) {
              this.observed.set(key, snapshot.hash + policy);
              return;
            }
            const { actor, message } = result.decision;
            if (!bots[actor])
              throw Error("The bot service returned a non-bot actor.");
            try {
              await this.comparison.api("/synchronize", {
                games: live.targets.map((w) => w.clone.game_id),
                source: live.source.clone.game_id,
                actor,
                message,
                expectedHash: snapshot.hash,
              });
              for (const w of live.targets) {
                w.botError = null;
                w.botWarning = result.warning || null;
              }
            } catch (error) {
              if (error.status === 409 && error.message.includes("stale"))
                return;
              throw error;
            }
          });
          this.comparison.sync.queue = work.catch(() => {});
          await work;
        } catch (error) {
          for (const w of targets)
            w.botError = "Bot decisions stopped: " + error.message;
          // Do not retry a broken service/policy every half-second. State or policy changes retry.
          const current = await this.comparison
            .api(`/games/${source.clone.game_id}`, undefined, "GET")
            .catch(() => null);
          if (current) this.observed.set(key, current.hash + policy);
        }
      }
    } catch (error) {
      this.comparison.sync.error = "Bot coordination stopped: " + error.message;
    } finally {
      this.running = false;
    }
  }
}
