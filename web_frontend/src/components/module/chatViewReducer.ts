export const RECENT_MESSAGE_COUNT = 6;

export type ChatViewState = {
  hasInteracted: boolean;
  hasUserSent: boolean;
  recentMessagesStartIdx: number;
  minHeightWrapperStartIdx: number;
  isExpanded: boolean;
  userSentFollowup: boolean;
};

export type ChatViewAction =
  | { type: "ACTIVATE"; messagesLength: number }
  | {
      type: "SEND_MESSAGE";
      messagesLength: number;
      hasScrollToResponse: boolean;
    }
  | { type: "EXPAND" }
  | { type: "COLLAPSE" };

export const initialChatViewState: ChatViewState = {
  hasInteracted: false,
  hasUserSent: false,
  recentMessagesStartIdx: 0,
  minHeightWrapperStartIdx: 0,
  isExpanded: false,
  userSentFollowup: false,
};

export function chatViewReducer(
  state: ChatViewState,
  action: ChatViewAction,
): ChatViewState {
  switch (action.type) {
    case "ACTIVATE":
      if (state.hasInteracted) return state;
      return {
        ...state,
        hasInteracted: true,
        recentMessagesStartIdx: action.messagesLength,
        minHeightWrapperStartIdx: action.messagesLength,
      };

    case "SEND_MESSAGE": {
      const nextIdx = state.hasUserSent
        ? Math.max(0, action.messagesLength - RECENT_MESSAGE_COUNT)
        : action.messagesLength;
      return {
        ...state,
        hasInteracted: true,
        hasUserSent: true,
        recentMessagesStartIdx: Math.max(state.recentMessagesStartIdx, nextIdx),
        minHeightWrapperStartIdx: action.messagesLength,
        userSentFollowup: action.hasScrollToResponse || state.userSentFollowup,
      };
    }

    case "EXPAND":
      return { ...state, isExpanded: true };

    case "COLLAPSE":
      return { ...state, isExpanded: false };
  }
}
