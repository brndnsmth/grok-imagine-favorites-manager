/**
 * Grok Imagine Favorites Manager - UI
 */

var ProgressModal = {
  modal: null,
  cancelled: false,

  create() {
    if (this.modal) return;

    this.modal = document.createElement('div');
    this.modal.id = 'grok-favorites-progress-modal';
    this.modal.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(4px); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, system-ui, sans-serif;">
        <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; padding: 32px; min-width: 400px; max-width: 500px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
          <div style="font-size: 20px; font-weight: 600; color: #e5e5e5; margin-bottom: 8px;" id="grok-progress-title">Processing...</div>
          <div style="font-size: 14px; color: #888; margin-bottom: 20px;" id="grok-progress-subtitle">Please wait</div>
          <div style="background: #0a0a0a; border-radius: 8px; height: 8px; overflow: hidden; margin-bottom: 16px;">
            <div style="background: linear-gradient(90deg, #3b82f6, #8b5cf6); height: 100%; width: 0%; transition: width 0.3s ease; border-radius: 8px;" id="grok-progress-bar"></div>
          </div>
          <div style="font-size: 13px; color: #a0a0a0; line-height: 1.6; margin-bottom: 12px;" id="grok-progress-details">Starting...</div>
          <div style="font-size: 12px; color: #60a5fa; margin-bottom: 16px; min-height: 16px;" id="grok-progress-substatus"></div>
          <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; color: #fbbf24; font-size: 12px;">
             ⚠️ Operations may open background tabs. Do not close them manually.
          </div>
          <button id="grok-cancel-button" style="width: 100%; padding: 10px 16px; background: #2a1a1a; border: 1px solid #4a2a2a; border-radius: 8px; color: #ff6b6b; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s ease;">
            Cancel Operation
          </button>
        </div>
      </div>`;

    document.body.appendChild(this.modal);
    document.getElementById('grok-cancel-button').addEventListener('click', () => this.cancel());
  },

  show(title, subtitle = '') {
    this.cancelled = false;
    this.create();
    this.modal.style.display = 'flex';
    document.getElementById('grok-progress-title').textContent = title;
    document.getElementById('grok-progress-subtitle').textContent = subtitle;
    document.getElementById('grok-progress-bar').style.width = '0%';
    document.getElementById('grok-progress-details').textContent = 'Starting...';
    document.getElementById('grok-progress-substatus').textContent = '';
    
    const cancelBtn = document.getElementById('grok-cancel-button');
    cancelBtn.textContent = 'Cancel Operation';
    cancelBtn.disabled = false;
    cancelBtn.style.opacity = '1';
  },

  update(progress, details) {
    if (!this.modal) return;
    const percentage = Math.min(100, Math.max(0, progress));
    const bar = document.getElementById('grok-progress-bar');
    if (bar) bar.style.width = `${percentage}%`;
    const detailsEl = document.getElementById('grok-progress-details');
    if (detailsEl) detailsEl.textContent = details;
  },
  
  updateSubStatus(text) {
    if (!this.modal) return;
    const sub = document.getElementById('grok-progress-substatus');
    if (sub) sub.textContent = text;
  },

  cancel() {
    this.cancelled = true;
    this.update(0, 'Cancelling operation...');
    const cancelBtn = document.getElementById('grok-cancel-button');
    if (cancelBtn) {
      cancelBtn.textContent = 'Cancelling...';
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
    }
    setTimeout(() => this.remove(), 1000);
  },

  isCancelled() {
    return this.cancelled;
  },

  hide() {
    if (this.modal) this.modal.style.display = 'none';
  },

  remove() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }
};

window.ProgressModal = ProgressModal;
