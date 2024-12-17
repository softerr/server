import AbstractView from "./AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Root");
    }

    async getHtml() {
        return `
        <h1>Root</h1>
        `;
    }
}