import { Container } from "react-bootstrap";
import { Link } from "react-router-dom";

const NotFound = () => {
    return (
        <Container className="content px-3 text-center">
            <h1>404</h1>
            <p>This page isn't available</p>
            <Link to={`/quiz/`}>Back to homepage...</Link>
        </Container>
    );
};

export default NotFound;
