import div2 from "./div2";
import div3 from "./div3";

export default class {
        constructor() {
                this.element = document.createElement('div');
                this.element.id = 'div1';
        }

        render() {
                return [new div2(), new div2(), new div3()];
        }
}

if (module.hot) {
        module.hot.accept('./div3', () => {
                console.log('hot: div3');
        });
}
