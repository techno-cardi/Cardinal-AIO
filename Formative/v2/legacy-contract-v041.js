(() => {
  'use strict';

  // This file is intentionally boring. It is a checked-in copy of the
  // operation names/documents verified against the archived 0.4.1 engine.
  // Do not "simplify" operation names without a live probe.

  const VERSION = '0.4.1';
  const ARCHIVE_SHA256 = 'b62f567aaf3917df8b021c6ae00965176391f416537662b22303c9656facfda4';

  const DOCS = Object.freeze({
    permission: `query FormativePermissionCheck($formativeId: ID!) {
      formative(id: $formativeId) {
        _id
        practiceSet
        viewerPermissions
        __typename
      }
      assignmentForStudent(formativeId: $formativeId) {
        _id
        secure
        secureBrowserTestMode
        __typename
      }
      viewer {
        _id
        sectionInvites(grantingAccessToFormativeId: $formativeId) {
          code
          sentAt
          __typename
        }
        __typename
      }
    }`,

    layout: `query FormativeLayout($formativeId: ID!) {
      formative(id: $formativeId) {
        _id
        items {
          _id
          details {
            points
            isProcessing
            __typename
          }
          parentId
          position
          formativeSectionId
          subtype
          text
          type
          __typename
        }
        title
        viewerPermissions
        __typename
      }
    }`,

    create: `mutation FormativeTeacherAddFormativeItem(
      $formativeId: ID!,
      $subtype: FormativeItemSubType!,
      $parentId: ID,
      $input: FormativeItemInput!
    ) {
      payload: addFormativeItem(
        formativeId: $formativeId
        subtype: $subtype
        parentId: $parentId
        input: $input
      ) {
        formativeItem {
          _id
          __typename
        }
        __typename
      }
    }`,

    // The following mutation signatures and selection fields are copied from
    // the archived engine contract. For question updates the 0.4.1 engine used
    // the generic updateFormativeItem mutation; there is no separate literal
    // FormativeItemEditableUpdatePoints operation in the archived 0.4.1 file.
    updateQuestion: `mutation QuestionEditableUpdateFormativeItem($formativeItemId: ID!, $input: FormativeItemInput!) {
      updateFormativeItem(id: $formativeItemId, input: $input) {
        formativeItem {
          _id
          details {
            allowEquivalencies
            alternateText
            answerChoicePoints
            areChoiceExplanationsEnabled
            choiceLabels
            choices
            correctAnswers
            isCaseSensitive
            isDrawingEnabled
            isExtraCreditEnabled
            isKeywordGrading
            isPartialCredit
            isRandomized
            isRequired
            isRubricEnabled
            isRubricStudentViewDisabled
            partialCreditMode
            points
            preventReuseChoices
            preventSkippingVideo
            preventVideoCC
            preventVideoPlaybackSpeed
            showWordCount
            timestamp
            videoPlaybackRate
            videoTrimLocations
            __typename
          }
          subtype
          text
          type
          updatedAt
          __typename
        }
        __typename
      }
    }`,

    updateChoices: `mutation WithChoicesMutation($id: ID!, $input: FormativeItemInput!) {
      payload: updateFormativeItem(id: $id, input: $input) {
        formativeItem {
          _id
          details {
            answerChoicePoints
            choiceLabels
            choices
            correctAnswers
            isPartialCredit
            points
            targets {
              label
              choices
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }`,

    updateFillBlank: `mutation FillInTheBlankEditableContainerMutation($formativeItemId: ID!, $input: FormativeItemInput!) {
      payload: updateFormativeItem(id: $formativeItemId, input: $input) {
        formativeItem {
          _id
          details {
            blanks {
              choiceLabels
              choices
              correctAnswers
              key
              numeric
              __typename
            }
            __typename
          }
          text
          __typename
        }
        __typename
      }
    }`,

    updateMatching: `mutation MatchingEditableDetailsContainerMutation($formativeItemId: ID!, $input: FormativeItemInput!) {
      payload: updateFormativeItem(id: $formativeItemId, input: $input) {
        formativeItem {
          _id
          details {
            choiceLabels
            choices
            correctAnswers
            labels
            __typename
          }
          __typename
        }
        __typename
      }
    }`,

    updateText: `mutation TextEditableUpdate($formativeItemId: ID!, $text: String!) {
      updateFormativeItem(id: $formativeItemId, input: {text: $text}) {
        formativeItem {
          _id
          html
          text
          __typename
        }
        __typename
      }
    }`
  });

  const OPS = Object.freeze({
    permission: Object.freeze({ kind: 'query', path: 'query/FormativePermissionCheck', operationName: 'FormativePermissionCheck', document: DOCS.permission }),
    layout: Object.freeze({ kind: 'query', path: 'query/FormativeLayout', operationName: 'FormativeLayout', document: DOCS.layout }),
    create: Object.freeze({ kind: 'mutation', path: 'mutation/FormativeTeacherAddFormativeItem', operationName: 'FormativeTeacherAddFormativeItem', document: DOCS.create }),
    updateQuestion: Object.freeze({ kind: 'mutation', path: 'mutation/QuestionEditableUpdateFormativeItem', operationName: 'QuestionEditableUpdateFormativeItem', document: DOCS.updateQuestion }),
    updateChoices: Object.freeze({ kind: 'mutation', path: 'mutation/WithChoicesMutation', operationName: 'WithChoicesMutation', document: DOCS.updateChoices }),
    updateFillBlank: Object.freeze({ kind: 'mutation', path: 'mutation/FillInTheBlankEditableContainerMutation', operationName: 'FillInTheBlankEditableContainerMutation', document: DOCS.updateFillBlank }),
    updateMatching: Object.freeze({ kind: 'mutation', path: 'mutation/MatchingEditableDetailsContainerMutation', operationName: 'MatchingEditableDetailsContainerMutation', document: DOCS.updateMatching }),
    updateText: Object.freeze({ kind: 'mutation', path: 'mutation/TextEditableUpdate', operationName: 'TextEditableUpdate', document: DOCS.updateText })
  });

  function get(name) {
    const op = OPS[name];
    if (!op) throw new Error(`Unknown 0.4.1 Formative operation: ${name}`);
    return op;
  }

  const api = { VERSION, ARCHIVE_SHA256, DOCS, OPS, get };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV041Contract = api;
})();