export class ReminderScheduler {
  constructor(service, deliver, { interval = 1000, onError = console.error } = {}) {
    this.service = service; this.deliver = deliver; this.interval = interval; this.onError = onError; this.running = false;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try { for (const memo of await this.service.claimReminders()) await this.deliver(memo); }
    catch (error) { this.onError(error); }
    finally { this.running = false; }
  }
  start() { if (this.timer) return; this.tick(); this.timer = setInterval(() => this.tick(), this.interval); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; }
}
