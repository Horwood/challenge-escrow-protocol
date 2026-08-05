// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

contract AdversarialToken {
    enum OutgoingMode {
        NORMAL,
        RETURN_FALSE,
        REVERT_CALL,
        NO_RETURN,
        MALFORMED_RETURN,
        RETURN_NON_ONE,
        UNDERCREDIT_RECIPIENT,
        OVERCREDIT_RECIPIENT,
        UNDERDEBIT_ESCROW,
        OVERDEBIT_ESCROW,
        REENTER,
        POST_BALANCE_REVERT,
        POST_BALANCE_MALFORMED
    }

    enum BalanceMode {
        NORMAL,
        REVERT_CALL,
        MALFORMED_RETURN
    }

    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    OutgoingMode public outgoingMode;
    BalanceMode public balanceMode;
    address public blockedRecipient;
    address public reentryTarget;
    bytes public reentryCalldata;
    bool public reentrySucceeded;
    bytes4 public reentryResultSelector;

    mapping(address account => uint256 amount) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(_balances[from] >= amount, "BALANCE");
        _balances[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function setOutgoingMode(OutgoingMode mode) external {
        outgoingMode = mode;
    }

    function setBalanceMode(BalanceMode mode) external {
        balanceMode = mode;
    }

    function setBlockedRecipient(address recipient) external {
        blockedRecipient = recipient;
    }

    function setReentry(address target, bytes calldata callData) external {
        reentryTarget = target;
        reentryCalldata = callData;
        reentrySucceeded = false;
        reentryResultSelector = bytes4(0);
    }

    function balanceOf(address account) external view returns (uint256) {
        if (balanceMode == BalanceMode.REVERT_CALL) revert("BALANCE_REVERT");
        if (balanceMode == BalanceMode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return _balances[account];
    }

    function rawBalanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ALLOWANCE");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _move(from, to, amount, amount);
        if (outgoingMode == OutgoingMode.RETURN_NON_ONE) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == blockedRecipient && to != address(0)) revert("BLOCKED_RECIPIENT");
        OutgoingMode mode = outgoingMode;
        if (mode == OutgoingMode.REVERT_CALL) revert("TRANSFER_REVERT");
        if (mode == OutgoingMode.RETURN_FALSE) return false;

        if (mode == OutgoingMode.REENTER) {
            (bool succeeded, bytes memory result) = reentryTarget.call(reentryCalldata);
            reentrySucceeded = succeeded;
            if (result.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(result, 0x20))
                }
                reentryResultSelector = selector;
            }
        }

        uint256 debited = amount;
        uint256 credited = amount;
        if (mode == OutgoingMode.UNDERCREDIT_RECIPIENT) credited = amount - 1;
        if (mode == OutgoingMode.OVERCREDIT_RECIPIENT) credited = amount + 1;
        if (mode == OutgoingMode.UNDERDEBIT_ESCROW) debited = amount - 1;
        if (mode == OutgoingMode.OVERDEBIT_ESCROW) debited = amount + 1;
        _move(msg.sender, to, debited, credited);

        if (mode == OutgoingMode.POST_BALANCE_REVERT) {
            balanceMode = BalanceMode.REVERT_CALL;
        }
        if (mode == OutgoingMode.POST_BALANCE_MALFORMED) {
            balanceMode = BalanceMode.MALFORMED_RETURN;
        }
        if (mode == OutgoingMode.NO_RETURN) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == OutgoingMode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        if (mode == OutgoingMode.RETURN_NON_ONE) {
            assembly ("memory-safe") {
                mstore(0, 2)
                return(0, 32)
            }
        }
        return true;
    }

    function _move(address from, address to, uint256 debited, uint256 credited) private {
        require(_balances[from] >= debited, "BALANCE");
        _balances[from] -= debited;
        _balances[to] += credited;
        if (credited > debited) totalSupply += credited - debited;
        if (debited > credited) totalSupply -= debited - credited;
        emit Transfer(from, to, credited);
    }
}
