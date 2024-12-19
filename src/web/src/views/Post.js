import AbstractView from "../render/AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Post");
    }

    async render() {
        console.log('Post');
        return `
        <h1>Post ${this.params['id']}</h1>
        `;
    }
}
