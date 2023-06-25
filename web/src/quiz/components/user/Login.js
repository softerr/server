import { useRef, useState } from "react";
import { Alert, Button, Container, Form } from "react-bootstrap";
import { useDispatch } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import myFetch from "../../../hooks/myFetch";

const Login = () => {
    const dispatch = useDispatch();
    const emailRef = useRef(null);
    const passwordRef = useRef(null);
    const navigate = useNavigate();
    const [formErrors, setFormErrors] = useState({});
    const location = useLocation();

    const handleSubmit = e => {
        e.preventDefault();

        const email = emailRef.current.value;
        const password = passwordRef.current.value;

        const errors = {};

        if (!email.trim()) {
            errors.email = "Email is required";
        } else if (!email.match(/^\S+@\S+\.\S+$/)) {
            errors.email = "Email format is not valid";
        }

        if (!password.trim()) {
            errors.password = "Password ir required";
        } else if (password.length < 8) {
            errors.password = "Wrong password";
        }

        setFormErrors(errors);
        if (Object.keys(errors).length === 0) {
            myFetch(
                "/api/quiz/signin",
                "POST",
                undefined,
                { email, password },
                data => {
                    dispatch({ type: "SIGN_IN", token: data.token });
                    navigate("/quiz/");
                },
                res => {
                    if (res.code === 3) {
                        const errors = {};
                        errors.password = "Wrong password";
                        setFormErrors(errors);
                    } else {
                        console.log(res);
                    }
                }
            );
        }
    };

    return (
        <Container fluid="sm" className="content px-3" style={{ maxWidth: "576px" }}>
            {location.state?.message && (
                <Alert variant="success">
                    <p>{location.state.message}</p>
                </Alert>
            )}
            <Form onSubmit={handleSubmit} noValidate>
                <h1 className="text-center">Login</h1>
                <Form.Group className="mb-3">
                    <Form.Label>Email address</Form.Label>
                    <Form.Control type="email" placeholder="Enter email" ref={emailRef} isInvalid={!!formErrors.email}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.email}</Form.Control.Feedback>
                </Form.Group>
                <Form.Group className="mb-3">
                    <Form.Label>Password</Form.Label>
                    <Form.Control type="password" placeholder="Password" ref={passwordRef} isInvalid={!!formErrors.password}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.password}</Form.Control.Feedback>
                    <Form.Text>
                        <Link to={`/quiz/forgot_password`} className="alink">
                            Forgot password?
                        </Link>
                    </Form.Text>
                </Form.Group>
                <div className="d-grid">
                    <Button variant="primary" type="submit">
                        Log In
                    </Button>
                </div>
                <div className="text-center">
                    <Form.Text>
                        Not a member?{" "}
                        <Link to={`/quiz/signup`} className="alink">
                            Sign up
                        </Link>
                    </Form.Text>
                </div>
            </Form>
        </Container>
    );
};

export default Login;
