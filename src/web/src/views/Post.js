import AbstractView from "../render/AbstractView.js";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("Post");
        this.element = document.createElement('div');
    }

    child() {
        return [`
        <h1>Post ${this.params['id']}</h1>
        `];
    }
}
