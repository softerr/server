import { useRef, useState } from "react";
import { Alert, Button, Container, Form, Spinner } from "react-bootstrap";
import myFetch from "../../hooks/myFetch";

const Login = () => {
    const emailRef = useRef(null);
    const [{ formErrors, sending, sent }, setState] = useState({ formErrors: {}, sending: false, sent: false });

    const handleSubmit = e => {
        e.preventDefault();

        const email = emailRef.current.value;

        const errors = {};

        if (!email.trim()) {
            errors.email = "Email is required";
        } else if (!email.match(/^\S+@\S+\.\S+$/)) {
            errors.email = "Email format is not valid";
        }

        if (Object.keys(errors).length === 0) {
            setState({ sending: true, sent: false, formErrors: errors });
            myFetch(
                "/api/quiz/forgot_password",
                "POST",
                undefined,
                { email },
                data => {
                    setState({ sending: false, sent: true, formErrors: {} });
                },
                res => {
                    setState({ sending: false, sent: false, formErrors: {} });
                    console.log(res);
                }
            );
        } else {
            setState({ sending: false, sent: false, formErrors: errors });
        }
    };

    return sending ? (
        <Container fluid="sm" className="d-flex justify-content-center" style={{ marginTop: "100px" }}>
            <Spinner animation="border" variant="primary" />
        </Container>
    ) : (
        <Container fluid="sm" className="content px-3" style={{ maxWidth: "576px" }}>
            {sent ? (
                <Alert variant="success">
                    <p>An email has been sent with a link to reset your password.</p>
                </Alert>
            ) : (
                <Form onSubmit={handleSubmit} noValidate>
                    <h1 className="text-center">Forgot password</h1>
                    <Form.Group className="mb-3">
                        <Form.Label>Email address</Form.Label>
                        <Form.Control type="email" placeholder="Enter email" ref={emailRef} isInvalid={!!formErrors.email}></Form.Control>
                        <Form.Control.Feedback type="invalid">{formErrors.email}</Form.Control.Feedback>
                    </Form.Group>
                    <div className="d-grid">
                        <Button variant="primary" type="submit">
                            Send
                        </Button>
                    </div>
                </Form>
            )}
        </Container>
    );
};

export default Login;
