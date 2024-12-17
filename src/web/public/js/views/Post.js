import AbstractView from "./AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        console.log(params);
        this.setTitle("Root");
    }

    async getHtml() {
        return `
        <h1>Post</h1>
        `;
    }
}