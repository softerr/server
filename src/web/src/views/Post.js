import AbstractView from "./AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Post");
    }

    async getHtml() {
        console.log('Post');
        return `
        <h1>Post</h1>
        `;
    }
}
