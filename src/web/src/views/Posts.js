import AbstractView from "./AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Posts");
    }

    async getHtml() {
        return `
        <h1>Tessst</h1>
        <h1>Pots</h1>
        <a href='/' data-link>Root</href>
        `;
    }
}
