// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Moves the canonical token only when call semantics and account deltas are exact.
library ExactTokenDelta {
    error TokenBalanceQueryFailed();
    error TokenTransferFromReverted();
    error TokenTransferFromReturnedFalse();
    error TokenTransferFromMalformedReturn(uint256 length);
    error TokenBalanceDeltaMismatch(uint256 expected, uint256 beforeBalance, uint256 afterBalance);
    error TokenTransferReverted();
    error TokenTransferReturnedFalse();
    error TokenTransferMalformedReturn(uint256 length);
    error TokenSenderBalanceDeltaMismatch(
        uint256 expected, uint256 beforeBalance, uint256 afterBalance
    );
    error TokenRecipientBalanceDeltaMismatch(
        uint256 expected, uint256 beforeBalance, uint256 afterBalance
    );

    function pullExact(address token, address from, uint256 amount) internal {
        uint256 beforeBalance = balanceOf(token, address(this));
        (bool success, bytes memory returnData) =
            token.call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        if (!success) revert TokenTransferFromReverted();

        if (returnData.length != 0) {
            if (returnData.length != 32) {
                revert TokenTransferFromMalformedReturn(returnData.length);
            }
            uint256 returned;
            assembly ("memory-safe") {
                returned := mload(add(returnData, 0x20))
            }
            if (returned == 0) revert TokenTransferFromReturnedFalse();
            if (returned != 1) revert TokenTransferFromMalformedReturn(returnData.length);
        }

        uint256 afterBalance = balanceOf(token, address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert TokenBalanceDeltaMismatch(amount, beforeBalance, afterBalance);
        }
    }

    function pushExact(address token, address to, uint256 amount)
        internal
        returns (uint256 afterSenderBalance)
    {
        uint256 beforeSenderBalance = balanceOf(token, address(this));
        uint256 beforeRecipientBalance = balanceOf(token, to);
        (bool success, bytes memory returnData) =
            token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!success) revert TokenTransferReverted();

        if (returnData.length != 0) {
            if (returnData.length != 32) {
                revert TokenTransferMalformedReturn(returnData.length);
            }
            uint256 returned;
            assembly ("memory-safe") {
                returned := mload(add(returnData, 0x20))
            }
            if (returned == 0) revert TokenTransferReturnedFalse();
            if (returned != 1) revert TokenTransferMalformedReturn(returnData.length);
        }

        afterSenderBalance = balanceOf(token, address(this));
        uint256 afterRecipientBalance = balanceOf(token, to);
        if (
            afterSenderBalance > beforeSenderBalance
                || beforeSenderBalance - afterSenderBalance != amount
        ) {
            revert TokenSenderBalanceDeltaMismatch(amount, beforeSenderBalance, afterSenderBalance);
        }
        if (
            afterRecipientBalance < beforeRecipientBalance
                || afterRecipientBalance - beforeRecipientBalance != amount
        ) {
            revert TokenRecipientBalanceDeltaMismatch(
                amount, beforeRecipientBalance, afterRecipientBalance
            );
        }
    }

    function balanceOf(address token, address account) internal view returns (uint256 result) {
        (bool success, bytes memory returnData) =
            token.staticcall(abi.encodeCall(IERC20.balanceOf, (account)));
        if (!success || returnData.length != 32) revert TokenBalanceQueryFailed();
        assembly ("memory-safe") {
            result := mload(add(returnData, 0x20))
        }
    }
}
