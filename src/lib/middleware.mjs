export class MiddlewareChain {
    constructor() {
        this._middlewares = [];
    }

    use(middleware) {
        this._middlewares.push(middleware);
    }

    async execute(phase, data) {
        let result = data;
        for (const mw of this._middlewares) {
            if (typeof mw[phase] === 'function') {
                result = await mw[phase](result) ?? result;
            }
        }
        return result;
    }
}
