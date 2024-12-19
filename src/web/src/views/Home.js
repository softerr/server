import AbstractView from "../render/AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Home");
    }

    async render() {
        return `
        <h1>Test</h1>
        <h1>Home</h1>
        <a href='/post' data-link>Posts</href>
        `;
    }
}
