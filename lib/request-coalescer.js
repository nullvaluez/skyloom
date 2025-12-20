/**
 * Request Coalescer
 * Coalesces multiple rapid requests into a single request
 * Useful for map pan/zoom where many position changes happen quickly
 */
export class RequestCoalescer {
  constructor(fetchFn, delay = 300) {
    this.fetchFn = fetchFn;
    this.delay = delay;
    this.pending = null;
    this.timeout = null;
  }

  /**
   * Request data with coalescing
   * Multiple rapid calls will be combined into a single request
   * @param {Object} params - Parameters to pass to fetchFn
   * @returns {Promise} Promise that resolves with the fetch result
   */
  request(params) {
    // Clear any pending timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    // If there's a pending promise, just update the params
    if (this.pending) {
      this.pending.params = params;
      return this.pending.promise;
    }

    // Create new pending request
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.pending = { params, promise, resolve, reject };

    // Schedule execution
    this.timeout = setTimeout(() => this._execute(), this.delay);

    return promise;
  }

  /**
   * Execute the pending request
   * @private
   */
  async _execute() {
    const { params, resolve, reject } = this.pending;
    this.pending = null;
    this.timeout = null;

    try {
      const result = await this.fetchFn(params);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }

  /**
   * Cancel any pending request
   */
  cancel() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.pending) {
      this.pending.reject(new Error('Request cancelled'));
      this.pending = null;
    }
  }

  /**
   * Force immediate execution of pending request
   */
  flush() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this._execute();
    }
  }
}

/**
 * Create a coalesced version of any async function
 * @param {Function} fn - Async function to coalesce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Coalesced function
 */
export function createCoalescedFn(fn, delay = 300) {
  const coalescer = new RequestCoalescer(fn, delay);
  return (params) => coalescer.request(params);
}

export default RequestCoalescer;
