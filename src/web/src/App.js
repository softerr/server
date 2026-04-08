import router from "./render/router";
import AbstractView from "./render/AbstractView";
import Home from "./views/Home";
import Post from "./views/Post";
import Posts from "./views/Posts";

export default class extends AbstractView {
    constructor(params) {
        super(params);
        this.setTitle("App");
    }

    child() {
        const view = router([
            { path: '/', view: Home },
            { path: '/post', view: Posts },
            { path: '/post/:id', view: Post },
        ]);

        return [{ view: view }];
    }
}
