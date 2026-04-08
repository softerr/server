import AbstractView from "../render/AbstractView.js";
import Post from "./Post.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Posts");
        
        
    }

    child() {
        return [
            `
        <h1>Test</h1>
        <h1>Posts</h1>
        `,
            { view: Post, params: { id: 2 } },
        `
         <a href='/' data-link>Root</href>
         `
        ];
    }
}
