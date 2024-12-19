import AbstractView from "../render/AbstractView.js";
import Post from "./Post.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Posts");
    }

    async render() {
        const post = await new Post({'id': 0}).render();
        return `
        <h1>Test</h1>
        <h1>Posts</h1>
        ${post}
        <a href='/' data-link>Root</href>
        `;
    }
}
