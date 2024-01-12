# Installation

-   Preparation
    -   Setup email
        -   [Enable 2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification)
        -   [Add app password](https://myaccount.google.com/apppasswords)
-   Installation
    -   Production
        -   Run on server to install and configure server:
            ```
            sudo ./scripts/install prod ...
            ```
        -   Run on local machine to build image:
            ```
            ./scripts/prepare
            ./scripts/build
            ```
        -   Copy `build` folder to server and run:
            ```
            /scripts/deploy
            ```
    -   Development
        -   Run to install and configure development environment:
            ```
            sudo ./scripts/install dev ...
            ```
