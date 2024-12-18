import AbstractView from "./AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Root");
    }

    async getHtml() {
        return `
        <h1>Tet</h1>
        <h1>Root</h1>
        <a href='/post' data-link>Posts</href>
        `;
    }
}