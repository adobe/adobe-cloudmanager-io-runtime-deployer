# Adobe Cloud Manager I/O Runtime Deployer

This project contains actions for Adobe I/O Runtime which allow for _other_ Runtime actions to be deployed in coordination with a CI/CD pipeline executed by Adobe Cloud Manager. While these actions are fully functional, they are intended primarily for use as a reference point for users of Cloud Manager and I/O Runtime as a basis for their own actions.

## Use Case

The target use case for this project is when a single git repository contains both the Adobe Experience Manager project code and one or more I/O Runtime actions which are tightly coupled to the AEM project code, i.e. when a deployment to AEM is done, the I/O Runtime actions need to be deployed.

The expected project structure is that there will be a top-level directory in the git repository named `runtime-actions`, i.e.

```
+-- pom.xml
+-- core
+-- ui.apps
+-- ui.content
+-- dispatcher
+-- runtime-actions
```

Within this `runtime-actions` directory, there are one or more sub-directories, each containing one Runtime action, which could be as simple as just a `package.json` file and an `index.js` file, e.g.

```
+-- pom.xml
+-- core
+-- ui.apps
+-- ui.content
+-- dispatcher
+-- runtime-actions
    +-- echo
        +-- index.js
        +-- package.json
```

When each pipeline step is started in Cloud Manager, an Event Handler in Adobe I/O is called which executes the `cmdeployer/event-handler` action. If the step being started is a deploy step for a dev environment, the actions in the `runtime-actions` directory are deployed with a `dev` postfix, e.g. `echo-dev` in the example above. If the step being started is a deploy step for a stage environment, the actions are deployed with a postfix corresponding to the version assigned by Cloud Manager, e.g. `echo-2019.826.190156.0000015537`.

Further, when the approval step in Cloud Manager enters the waiting state, the same Event Handler is used to reject or approve the execution based on whether or not the deployment of the versioned action was successful. In practice, it is possible that additional (even manual) approvals are necessary, so real-world usage for the waiting piece may vary.

## Configuration

1. Create an integration in the Adobe Console I/O which has API access to Cloud Manager and either the Business Owner or Deployment Manager role.
2. Create `deploy/.env` with 

```
GIT_URL=the URL of your Cloud Manager git repository
GIT_USERNAME=a username
GIT_PASSWORD=a password
```

3. Create `event-handler/.env` with

```
API_KEY=the API key for the integration
TECHNICAL_ACCOUNT_ID=the technical account email for the integration
ORGANIZATION_ID=the org id for the integration
CLIENT_SECRET=the client secret for the integration
PROGRAM_ID=the program id
```

4. Put your `private.key` file in `event-handler` (i.e. `event-handler/private.key`)

## Building

```
$ cd deploy
$ npm install
$ cd ../event-handler
$ npm install
```

## Installing

```
$ aio console:list-integrations
$ aio console:select-integration <INTEGRATION ID>
$ wskdeploy
```

> Due to a bug in the I/O Console, you need to create a sequence for the `event-handler` action, e.g. `wsk action create cmdeployer --sequence cmruntime/event-handler` before proceeding to the next step.

## Enabling

1. Add your I/O Runtime actions to your Cloud Manager git repository.
2. In the Adobe I/O Console, add an Event Registration for the Cloud Manager Event Provider which receives Pipeline Execution Step Started and Pipeline Execution Step Waiting events and uses the `event-handler` action (or a sequence containing it).
3. Start a pipeline in Cloud Manager


### Contributing

Contributions are welcomed! Read the [Contributing Guide](./.github/CONTRIBUTING.md) for more information.

### Licensing

This project is licensed under the Apache V2 License. See [LICENSE](LICENSE) for more information.
